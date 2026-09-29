import React from "react";
import { readFileSync } from "fs";
import { resolve } from "path";
import vm from "vm";
import ts from "typescript";
const { create, act } = require("react-test-renderer");

// Mount the actual root. Native services, routing and every external operation
// are replaced; no SDK, token registration, notification or fetch can run.
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const session = (id: string) => ({ user: { id } });
function harness(options: { noUsernameFor?: string } = {}) {
  let currentId: string | null = null;
  const gate: Record<string, any> = {};
  const gateSource = readFileSync(resolve(__dirname, "../username-gate.ts"), "utf8");
  vm.runInNewContext(ts.transpileModule(gateSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: gate });
  const restore = deferred<any>();
  let onAuth!: (event: string, value: any) => void;
  const unsubscribe = jest.fn();
  const mounted: number[] = [], unmounted: number[] = [];
  let serial = 0;
  function Stack() {
    const [instance] = React.useState(() => ++serial);
    const [draft, setDraft] = React.useState("");
    React.useEffect(() => { mounted.push(instance); return () => { unmounted.push(instance); }; }, [instance]);
    return React.createElement("screen-probe", { instance, draft, onChange: setDraft });
  }
  Stack.Screen = () => null;
  const router = { push: jest.fn(), replace: jest.fn() };
  const segments = ["(tabs)"];
  const remove = () => ({ remove: jest.fn() });
  const wrap = ({ children }: any) => children;
  const noopAsync = jest.fn(async () => undefined);
  const exports: Record<string, any> = {};
  const invalidations: string[] = [];
  const named = new Proxy({}, { get: (_target, name) => {
    if (name === "getMyProfile") return async () => ({ username: currentId === options.noUsernameFor ? null : "synthetic" });
    if (name === "currentPermissionState") return async () => ({ always: false, whenInUse: false });
    if (name === "needsNotificationPrimer" || name === "shouldPromptNow") return async () => false;
    if (name === "isUsernameClaimed" || name === "isPrimerSeen") return () => false;
    if (name === "subscribeUsernameClaimed" || name === "subscribePrimerSeen") return () => () => {};
    if (name === "addVisitListener") return remove;
    if (name === "invalidatePersonalSignal" || name === "invalidateCompatibilityCache") return () => invalidations.push(String(name));
    if (name === "ScreenshotFeedbackSheet") return () => null;
    if (name === "Text") return "text";
    return noopAsync;
  } });
  const source = readFileSync(resolve(__dirname, "../../app/_layout.tsx"), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText, {
    exports, console, fetch: () => { throw Error("Network forbidden"); },
    require(name: string) {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return require("react/jsx-runtime");
      if (name === "expo-router") return { Stack, useRouter: () => router, useSegments: () => segments };
      if (name === "react-native") return { View: "view", Pressable: "pressable", ActivityIndicator: "spinner", AppState: { addEventListener: remove } };
      if (name === "react-native-safe-area-context") return { SafeAreaProvider: wrap };
      if (name === "react-native-gesture-handler") return { GestureHandlerRootView: wrap };
      if (name === "expo-status-bar") return { StatusBar: () => null };
      if (name === "@expo-google-fonts/inter") return { useFonts: () => [true, null] };
      if (name === "expo-notifications") return { setNotificationHandler: () => {}, getLastNotificationResponseAsync: async () => null, addNotificationResponseReceivedListener: remove };
      if (name === "expo-screen-capture") return { addScreenshotListener: remove };
      if (name === "expo-web-browser") return { maybeCompleteAuthSession: () => {} };
      if (name === "../theme") return { colors: {} };
      if (name === "../lib/username-gate") return gate;
      if (name === "../lib/supabase") return { supabase: { auth: { getSession: () => restore.promise, onAuthStateChange: (callback: typeof onAuth) => { onAuth = callback; return { data: { subscription: { unsubscribe } } }; } } } };
      if (name.startsWith("../")) return named;
      throw Error(`Unmocked module: ${name}`);
    },
  });
  return { Root: exports.default, restore, gate, router, auth: (value: any) => { currentId = value?.user.id ?? null; onAuth("SIGNED_IN", value); }, mounted, unmounted, unsubscribe, invalidations };
}

test("account replacement resets mounted screen state; same-account refresh preserves it", async () => {
  const h = harness(); let tree: any;
  await act(async () => { tree = create(<h.Root />); });
  await act(async () => { h.auth(session("A")); });
  const probe = () => tree.root.findByType("screen-probe");
  const first = probe().props.instance;
  await act(async () => { probe().props.onChange("A's draft"); });
  await act(async () => { h.auth(session("A")); });
  expect(probe().props.instance).toBe(first);
  expect(probe().props.draft).toBe("A's draft");
  await act(async () => { h.auth(session("B")); });
  expect(probe().props.instance).not.toBe(first);
  expect(probe().props.draft).toBe("");
  expect(h.unmounted).toContain(first);
  const second = probe().props.instance;
  await act(async () => { h.auth(null); });
  expect(probe().props.instance).not.toBe(second);
  expect(h.unmounted).toContain(second);
  expect(h.invalidations).toHaveLength(8);
  await act(async () => { tree.unmount(); });
});

test("late restore cannot replace a newer auth event or remount its screen", async () => {
  const h = harness(); let tree: any;
  await act(async () => { tree = create(<h.Root />); });
  await act(async () => { h.auth(session("B")); });
  const instance = tree.root.findByType("screen-probe").props.instance;
  await act(async () => { h.restore.resolve({ data: { session: session("A") } }); });
  expect(tree.root.findByType("screen-probe").props.instance).toBe(instance);
  expect(h.mounted).toHaveLength(1);
  await act(async () => { tree.unmount(); });
});

test("ordinary restore mounts once and callbacks after unmount do nothing", async () => {
  const h = harness(); let tree: any;
  await act(async () => { tree = create(<h.Root />); });
  expect(h.mounted).toHaveLength(0);
  await act(async () => { h.restore.resolve({ data: { session: session("A") } }); });
  expect(h.mounted).toHaveLength(1);
  await act(async () => { tree.unmount(); });
  const count = h.invalidations.length;
  await act(async () => { h.auth(session("B")); });
  expect(h.invalidations).toHaveLength(count);
  expect(h.unsubscribe).toHaveBeenCalledTimes(1);
});


test("a handle claimed by A does not bypass B's actual username gate", async () => {
  const h = harness({ noUsernameFor: "B" }); let tree: any;
  await act(async () => { tree = create(<h.Root />); });
  await act(async () => { h.auth(session("A")); });
  const oldSave = h.gate.usernameGateSession();
  await act(async () => { h.gate.markUsernameClaimed(oldSave); });
  h.router.replace.mockClear();
  await act(async () => { h.auth(session("B")); });
  expect(h.router.replace).toHaveBeenCalledWith("/claim-username");
  expect(h.gate.isUsernameClaimed()).toBe(false);
  await act(async () => { expect(h.gate.markUsernameClaimed(oldSave)).toBe(false); });
  expect(h.gate.isUsernameClaimed()).toBe(false);
  await act(async () => { tree.unmount(); });
});
