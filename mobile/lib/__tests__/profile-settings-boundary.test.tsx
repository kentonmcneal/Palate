import React from "react";
import { readFileSync } from "fs";
import { resolve } from "path";
import vm from "vm";
import ts from "typescript";
const { create, act } = require("react-test-renderer");
function deferred() {
  let resolve!: (value: any) => void, reject!: (error: Error) => void;
  const promise = new Promise<any>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
// Real screens and real account-generation state. All native/SDK operations
// are mocks; retained callbacks are deliberately invoked after actual unmount.
function harness(file: string) {
  const gate: any = {};
  const compile = (file: string) => ts.transpileModule(readFileSync(resolve(__dirname, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(compile("../username-gate.ts"), { exports: gate });
  gate.setUsernameGateAccount("A");
  const profile = { getMyProfile: jest.fn(async () => ({ id: "A", profile_visibility: "friends" })), uploadAvatar: jest.fn(async () => "new-avatar"), setProfileVisibility: jest.fn(async () => undefined) };
  const picker = { requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })), launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: "file:///A.jpg" }] })), MediaTypeOptions: { Images: "images" } };
  const alert = jest.fn(), signOut = jest.fn(async () => { gate.setUsernameGateAccount(null); });
  const deletes = { deleteHistoryForAccount: jest.fn(async () => ({ error: null })), deleteAccountForAccount: jest.fn(async () => ({ error: null })) };
  const router = { back: jest.fn(), replace: jest.fn(), push: jest.fn() };
  const readFunctionError = jest.fn(async () => "synthetic error");
  const noop = jest.fn(async () => false);
  const named = new Proxy({}, { get: (_target, key) => {
    if (["Text", "TextInput", "Avatar", "UsernameField", "Button", "Spacer", "CollapsibleSection"].includes(String(key))) return String(key);
    if (key === "BIO_MAX") return 160;
    if (key === "SCHOOL_MAX") return 80;
    if (key === "FORWARDING_LIVE") return false;
    if (key === "getSocialPushPrefs") return async () => ({ likes: true, comments: true });
    if (key === "getGmailStatus") return async () => ({ connected: false });
    if (key === "suggestUsername") return () => "alice";
    if (key === "buildInfoLine") return () => "test build";
    return noop;
  } });
  const exports: any = {};
  vm.runInNewContext(compile(`../../app/${file}`), { exports, console, fetch: () => { throw Error("Network forbidden"); }, require: (id: string) => {
    // Unrelated capture control has its own real-component mounted suites.
    // Keep this explicit: the generic async helper proxy is not a React component.
    if (id === "../components/PassiveCaptureToggle") return { PassiveCaptureToggle: () => null };
    if (id === "react") return React;
    if (id === "react/jsx-runtime") return require("react/jsx-runtime");
    if (id === "react-native") return { View: "View", ScrollView: "ScrollView", Pressable: "Pressable", Modal: "Modal", Switch: "Switch", StyleSheet: { create: (s: any) => s }, Alert: { alert }, Linking: {}, Share: {} };
    if (id === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView" };
    if (id === "expo-router") return { useRouter: () => router, useFocusEffect: (cb: any) => React.useEffect(cb, [cb]) };
    if (id === "expo-image-picker") return picker;
    if (id === "@react-native-async-storage/async-storage") return { getItem: async () => null };
    if (id.endsWith("/theme")) return { colors: {}, spacing: {}, type: {} };
    if (id.endsWith("/lib/username-gate")) return gate;
    if (id.endsWith("/lib/account-write")) return { accountWriteSession: gate.usernameGateSession, isAccountWriteSession: gate.isUsernameGateSession };
    if (id.endsWith("/lib/profile")) return profile;
    if (id.endsWith("/lib/account-settings")) return deletes;
    if (id.endsWith("/lib/auth")) return { signOut, signOutForAccount: signOut };
    if (id.endsWith("/lib/function-error")) return { readFunctionError };
    if (id.endsWith("/lib/supabase")) return { supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getUser: async () => ({ data: { user: { id: "A" } } }) }, rpc: jest.fn(), functions: { invoke: jest.fn() } } };
    if (id.startsWith("../")) return named;
    throw Error(`Unmocked module: ${id}`);
  } });
  return { Screen: exports.default, gate, profile, picker, alert, deletes, router, signOut, readFunctionError };
}
const button = (tree: any, title: string) => tree.root.findByProps({ title });
const visibility = (tree: any, value: string) => tree.root.findByProps({ accessibilityLabel: `${value} profile visibility` });
const contents = (tree: any) => JSON.stringify(tree.toJSON());
for (const file of ["edit-profile.tsx", "onboarding/profile-setup.tsx"]) {
  test.each(["B", "A-B-A"])(`${file}: picker started by A cannot upload after %s`, async transition => {
    const h = harness(file), step = deferred(); h.picker.launchImageLibraryAsync.mockReturnValueOnce(step.promise);
    let tree: any, pending: any;
    await act(async () => { tree = create(<h.Screen />); });
    const label = file === "edit-profile.tsx" ? "Change profile photo" : "Choose photo";
    await act(async () => { pending = tree.root.findByProps({ accessibilityLabel: label }).props.onPress(); });
    await act(async () => { tree.unmount(); h.gate.setUsernameGateAccount("B"); if (transition === "A-B-A") h.gate.setUsernameGateAccount("A"); });
    await act(async () => { step.resolve({ canceled: false, assets: [{ uri: "file:///A.jpg" }] }); await pending; });
    expect(h.profile.uploadAvatar).not.toHaveBeenCalled(); expect(h.alert).not.toHaveBeenCalled();
  });
  test(`${file}: stale permission response never opens a picker`, async () => {
    const h = harness(file), step = deferred(); h.picker.requestMediaLibraryPermissionsAsync.mockReturnValueOnce(step.promise);
    let tree: any, pending: any; await act(async () => { tree = create(<h.Screen />); });
    await act(async () => { pending = tree.root.findByProps({ accessibilityLabel: file === "edit-profile.tsx" ? "Change profile photo" : "Choose photo" }).props.onPress(); });
    await act(async () => { tree.unmount(); h.gate.setUsernameGateAccount("B"); step.resolve({ granted: true }); await pending; });
    expect(h.picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });
  test(`${file}: current picker passes its initiating token to upload`, async () => {
    const h = harness(file); let tree: any; await act(async () => { tree = create(<h.Screen />); });
    await act(async () => { await tree.root.findByProps({ accessibilityLabel: file === "edit-profile.tsx" ? "Change profile photo" : "Choose photo" }).props.onPress(); });
    expect(h.profile.uploadAvatar).toHaveBeenCalledWith("file:///A.jpg", h.gate.usernameGateSession());
    await act(async () => { tree.unmount(); });
  });
}
for (const title of ["Delete all visit history", "Delete my account"]) {
  test.each(["B", "A-B-A"])(`${title}: retained confirmation cannot act after %s`, async transition => {
    const h = harness("settings.tsx"); let tree: any; await act(async () => { tree = create(<h.Screen />); });
    await act(async () => { button(tree, title).props.onPress(); });
    const confirm = h.alert.mock.calls[0][2].find((b: any) => b.style === "destructive").onPress;
    await act(async () => { tree.unmount(); h.gate.setUsernameGateAccount("B"); if (transition === "A-B-A") h.gate.setUsernameGateAccount("A"); await confirm(); });
    expect(h.deletes.deleteHistoryForAccount).not.toHaveBeenCalled(); expect(h.deletes.deleteAccountForAccount).not.toHaveBeenCalled(); expect(h.signOut).not.toHaveBeenCalled();
  });
  test(`${title}: same-account confirmation still submits`, async () => {
    const h = harness("settings.tsx"); let tree: any; await act(async () => { tree = create(<h.Screen />); });
    await act(async () => { button(tree, title).props.onPress(); });
    const token = h.gate.usernameGateSession();
    await act(async () => { await h.alert.mock.calls[0][2].find((b: any) => b.style === "destructive").onPress(); });
    expect(title === "Delete my account" ? h.deletes.deleteAccountForAccount : h.deletes.deleteHistoryForAccount).toHaveBeenCalledWith(token);
    await act(async () => { tree.unmount(); });
  });
}
test("old deletion completion never signs out or navigates B", async () => {
  const h = harness("settings.tsx"), step = deferred(); h.deletes.deleteAccountForAccount.mockReturnValueOnce(step.promise);
  let tree: any, pending: any; await act(async () => { tree = create(<h.Screen />); });
  await act(async () => { button(tree, "Delete my account").props.onPress(); pending = h.alert.mock.calls[0][2][1].onPress(); });
  await act(async () => { tree.unmount(); h.gate.setUsernameGateAccount("B"); step.resolve({ error: null }); await pending; });
  expect(h.signOut).not.toHaveBeenCalled(); expect(h.router.replace).not.toHaveBeenCalled();
});
test("deferred deletion error cannot display on B", async () => {
  const h = harness("settings.tsx"), step = deferred(); h.deletes.deleteAccountForAccount.mockResolvedValueOnce({ error: {} } as any); h.readFunctionError.mockReturnValueOnce(step.promise);
  let tree: any, pending: any; await act(async () => { tree = create(<h.Screen />); });
  await act(async () => { button(tree, "Delete my account").props.onPress(); pending = h.alert.mock.calls[0][2][1].onPress(); });
  await act(async () => { tree.unmount(); h.gate.setUsernameGateAccount("B"); step.resolve("A's error"); await pending; });
  expect(h.alert).toHaveBeenCalledTimes(1);
});
test("privacy serializes same-tick presses and shows no confirmed audience while pending", async () => {
  const h = harness("edit-profile.tsx"), step = deferred(); h.profile.setProfileVisibility.mockReturnValueOnce(step.promise);
  let tree: any, pending: any; await act(async () => { tree = create(<h.Screen />); });
  const first = visibility(tree, "private").props.onPress, second = visibility(tree, "public").props.onPress;
  await act(async () => { pending = first(); second(); });
  expect(h.profile.setProfileVisibility).toHaveBeenCalledTimes(1);
  expect(visibility(tree, "public").props.disabled).toBe(true);
  expect(contents(tree)).toContain("Saving or checking");
  expect(contents(tree)).not.toContain("Only you");
  await act(async () => { step.resolve(undefined); await pending; });
  expect(visibility(tree, "private").props.disabled).toBe(false);
  expect(visibility(tree, "private").props.style.filter(Boolean).length).toBe(2);
  await act(async () => { tree.unmount(); });
});
test("uncertain privacy error reads committed value rather than restoring old audience", async () => {
  const h = harness("edit-profile.tsx"); let tree: any; await act(async () => { tree = create(<h.Screen />); });
  h.profile.setProfileVisibility.mockRejectedValueOnce(Error("lost reply"));
  h.profile.getMyProfile.mockResolvedValueOnce({ id: "A", profile_visibility: "private" });
  await act(async () => { await visibility(tree, "private").props.onPress(); });
  expect(visibility(tree, "private").props.style.filter(Boolean).length).toBe(2);
  expect(visibility(tree, "friends").props.style.filter(Boolean).length).toBe(1);
  await act(async () => { tree.unmount(); });
});
test("failed reconciliation hides audience and blocks writes until explicit reload succeeds", async () => {
  const h = harness("edit-profile.tsx"); let tree: any; await act(async () => { tree = create(<h.Screen />); });
  h.profile.setProfileVisibility.mockRejectedValueOnce(Error("lost reply")); h.profile.getMyProfile.mockRejectedValueOnce(Error("offline"));
  await act(async () => { await visibility(tree, "private").props.onPress(); });
  for (const value of ["public", "friends", "private"]) { expect(visibility(tree, value).props.disabled).toBe(true); expect(visibility(tree, value).props.style.filter(Boolean).length).toBe(1); }
  h.profile.getMyProfile.mockResolvedValueOnce({ id: "A", profile_visibility: "private" });
  await act(async () => { button(tree, "Reload privacy setting").props.onPress(); });
  expect(visibility(tree, "private").props.disabled).toBe(false); expect(visibility(tree, "private").props.style.filter(Boolean).length).toBe(2);
  await act(async () => { tree.unmount(); });
});
test("late initial profile read cannot overwrite a newer privacy read and mutation", async () => {
  const h = harness("edit-profile.tsx"), initial = deferred(); h.profile.getMyProfile.mockReturnValueOnce(initial.promise);
  let tree: any; await act(async () => { tree = create(<h.Screen />); });
  await act(async () => { button(tree, "Reload privacy setting").props.onPress(); });
  await act(async () => { await visibility(tree, "private").props.onPress(); });
  await act(async () => { initial.resolve({ id: "A", profile_visibility: "public" }); });
  expect(visibility(tree, "private").props.style.filter(Boolean).length).toBe(2);
  await act(async () => { tree.unmount(); });
});
test("onboarding does not promise friends-only avatar access", async () => {
  const h = harness("onboarding/profile-setup.tsx"); let tree: any; await act(async () => { tree = create(<h.Screen />); });
  expect(contents(tree)).toContain("public"); expect(contents(tree)).not.toContain("never share your photo");
  await act(async () => { tree.unmount(); });
});
