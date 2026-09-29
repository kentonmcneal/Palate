import { readFileSync } from "fs";
import { resolve } from "path";
import vm from "vm";
import ts from "typescript";

function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>(r => { resolve = r; });
  return { promise, resolve };
}
const flush = async () => { for (let i = 0; i < 12; ++i) await Promise.resolve(); };
function harness() {
  const auth = deferred(), session = deferred();
  const eq = jest.fn(async () => ({ error: null }));
  const update = jest.fn(() => ({ eq }));
  const upload = jest.fn(async () => ({ error: null }));
  const arrayBuffer = jest.fn(async () => new ArrayBuffer(4));
  const fetch = jest.fn(async () => ({ arrayBuffer }));
  const setHeader = jest.fn(async () => ({ error: null }));
  const rpc = jest.fn(() => ({ setHeader }));
  const invoke = jest.fn(async () => ({ error: null }));
  const supabase = {
    auth: { getUser: jest.fn(() => auth.promise), getSession: jest.fn(() => session.promise) },
    from: jest.fn(() => ({ update })), rpc, functions: { invoke },
    storage: { from: jest.fn(() => ({ upload, getPublicUrl: () => ({ data: { publicUrl: "synthetic-avatar" } }) })) },
  };
  const cache: Record<string, any> = {};
  function load(name: string): any {
    if (cache[name]) return cache[name];
    const exports = cache[name] = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname, `../${name}.ts`), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, fetch, require: (id: string) => {
      if (id === "./supabase") return { supabase };
      if (id === "react-native") return { Linking: {} };
      if (id.startsWith("./")) return load(id.slice(2));
      throw Error(`Unmocked import ${id}`);
    } });
    return exports;
  }
  const gate = load("username-gate"); gate.setUsernameGateAccount("A");
  return { load, gate, auth, session, eq, update, upload, arrayBuffer, fetch, rpc, invoke, setHeader, supabase };
}
const writers: [string, string, any[]][] = [
  ["profile", "saveDemographics", [{ current_city: "A city" }]],
  ["profile", "setProfileVisibility", ["private"]],
  ["profile", "saveQuizResult", ["explorer", ["spicy"]]],
  ["profile", "saveTastePreferences", [["Thai"]]],
  ["profile", "uploadAvatar", ["file:///A.jpg"]],
  ["social", "saveSocialFields", [{ firstName: "Alice", bio: "A bio" }]],
  ["friend-push", "setFriendActivityPushEnabled", [false]],
  ["social-notifications", "setSocialPushPref", ["likes", false]],
];
for (const [module, method, args] of writers) {
  test.each(["B", "A-B-A", "signed-out", "mismatched-auth"])(`${method} rejects deferred auth: %s`, async transition => {
    const h = harness();
    const result = h.load(module)[method](...args).then(() => null, (error: Error) => error.message);
    if (transition !== "mismatched-auth") h.gate.setUsernameGateAccount(transition === "signed-out" ? null : "B");
    if (transition === "A-B-A") h.gate.setUsernameGateAccount("A");
    h.auth.resolve({ data: { user: { id: transition === "A-B-A" ? "A" : "B" } }, error: null });
    expect(await result).toMatch(/Account changed/);
    expect(h.update).not.toHaveBeenCalled(); expect(h.upload).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
  });
  test(`${method} permits same-account refresh and pins the row to A`, async () => {
    const h = harness(); const pending = h.load(module)[method](...args);
    h.gate.setUsernameGateAccount("A");
    h.auth.resolve({ data: { user: { id: "A" } }, error: null });
    await pending;
    expect(h.update).toHaveBeenCalledTimes(1); expect(h.eq).toHaveBeenCalledWith("id", "A");
    if (method === "uploadAvatar") expect(h.upload.mock.calls[0][0]).toMatch(/^A\//);
  });
}
test.each(["fetch", "arrayBuffer", "upload"])("avatar stops after account changes during %s", async stage => {
  const h = harness(), deferredStep = deferred();
  (h[stage as "fetch"] as jest.Mock).mockReturnValueOnce(deferredStep.promise);
  const pending = h.load("profile").uploadAvatar("file:///A.jpg").catch((e: Error) => e.message);
  h.auth.resolve({ data: { user: { id: "A" } }, error: null }); await flush();
  h.gate.setUsernameGateAccount("B");
  deferredStep.resolve(stage === "fetch" ? { arrayBuffer: h.arrayBuffer } : stage === "upload" ? { error: null } : new ArrayBuffer(4));
  expect(await pending).toMatch(/Account changed/);
  expect(h.update).not.toHaveBeenCalled();
  if (stage !== "upload") expect(h.upload).not.toHaveBeenCalled();
  if (stage === "fetch") expect(h.arrayBuffer).not.toHaveBeenCalled();
});
test("friend push write errors reach the UI", async () => {
  const h = harness(); h.eq.mockResolvedValueOnce({ error: { message: "failed" } } as any);
  h.auth.resolve({ data: { user: { id: "A" } } });
  await expect(h.load("friend-push").setFriendActivityPushEnabled(false)).rejects.toEqual({ message: "failed" });
});
for (const method of ["deleteHistoryForAccount", "deleteAccountForAccount"]) {
  test.each(["B", "A-B-A", "mismatched-auth"])(`${method} refuses stale confirmation/session: %s`, async transition => {
    const h = harness();
    const pending = h.load("account-settings")[method](h.gate.usernameGateSession()).catch((e: Error) => e.message);
    if (transition !== "mismatched-auth") h.gate.setUsernameGateAccount("B");
    if (transition === "A-B-A") h.gate.setUsernameGateAccount("A");
    h.session.resolve({ data: { session: { user: { id: transition === "A-B-A" ? "A" : "B" }, access_token: "test-token" } } });
    expect(await pending).toMatch(/Account changed/); expect(h.rpc).not.toHaveBeenCalled(); expect(h.invoke).not.toHaveBeenCalled();
  });
  test(`${method} explicitly pins authorization to the initiating JWT`, async () => {
    const h = harness();
    h.session.resolve({ data: { session: { user: { id: "A" }, access_token: "test-A-token" } } });
    await h.load("account-settings")[method](h.gate.usernameGateSession());
    if (method === "deleteHistoryForAccount") expect(h.setHeader).toHaveBeenCalledWith("Authorization", "Bearer test-A-token");
    else expect(h.invoke).toHaveBeenCalledWith("delete-account", { body: {}, headers: { Authorization: "Bearer test-A-token" } });
  });
}
