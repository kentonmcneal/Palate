import React from "react";
import { RefreshControl } from "react-native";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
const { create, act } = require("react-test-renderer");
import PeopleScreen from "../../app/people";
import { supabase } from "../supabase";
import { browseProfiles, loadCompatiblePeople, needsDiscoveryPrompt } from "../social";
import { loadPalateMatches } from "../palate/pairCompatibility";
import { searchUsers, listFollowing, followUser, unfollowUser } from "../friends";

const mockPush = jest.fn(), mockBack = jest.fn(), mockUnsubscribe = jest.fn();
let mockFocused = true;
let authChanged: (event: string, session: { user: { id: string } } | null) => void;
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useFocusEffect: (effect: () => void | (() => void)) => require("react").useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]),
}));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("../supabase", () => ({ supabase: { auth: { getSession: jest.fn(), onAuthStateChange: jest.fn() }, rpc: jest.fn() } }));
jest.mock("../social", () => ({ browseProfiles: jest.fn(), loadCompatiblePeople: jest.fn(), needsDiscoveryPrompt: jest.fn(), compatibilityLine: () => "Shared tastes" }));
jest.mock("../palate/pairCompatibility", () => ({ loadPalateMatches: jest.fn() }));
jest.mock("../friends", () => ({ searchUsers: jest.fn(), listFollowing: jest.fn(), followUser: jest.fn(), unfollowUser: jest.fn() }));
jest.mock("../haptics", () => ({ triggerHapticSelection: jest.fn() }));
jest.mock("../../components/Avatar", () => ({ Avatar: () => null }));

let tree: ReactTestRenderer | null = null;
const browse = browseProfiles as jest.Mock, similar = loadCompatiblePeople as jest.Mock, prompt = needsDiscoveryPrompt as jest.Mock;
const matches = loadPalateMatches as jest.Mock, search = searchUsers as jest.Mock, following = listFollowing as jest.Mock;
const rpc = supabase.rpc as jest.Mock, getSession = supabase.auth.getSession as jest.Mock;
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function person(id: string) { return { id, display_name: id, username: null, avatar_url: null, current_city: null, school: null }; }
function followed(id: string) { return { friend: person(id), youFollow: true, followsYou: false, since: null }; }
function textOf(node: ReactTestInstance): string { return node.children.map(c => typeof c === "string" ? c : textOf(c)).join(""); }
function text() { return textOf(tree!.root); }
function action(label: string) {
  const nodes = tree!.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === "function");
  expect(nodes).toHaveLength(1); return nodes[0];
}
async function press(label: string) { await act(async () => { action(label).props.onPress({ stopPropagation: jest.fn() }); }); }
async function enter(value: string) {
  const input = tree!.root.findAll(n => n.props.accessibilityLabel === "Search people" && typeof n.props.onChangeText === "function")[0];
  await act(async () => { input.props.onChangeText(value); });
}
async function mount() { await act(async () => { tree = create(<PeopleScreen />); }); }
async function refresh() {
  const control = tree!.root.findAll(n => n.props.refreshControl?.type === RefreshControl)[0].props.refreshControl;
  await act(async () => { control.props.onRefresh(); });
}
async function auth(id: string | null, event = "SIGNED_IN") { await act(async () => authChanged(event, id ? { user: { id } } : null)); }
async function focus(value: boolean) { mockFocused = value; await act(async () => tree!.update(<PeopleScreen />)); }

beforeEach(() => {
  jest.resetAllMocks(); mockFocused = true;
  getSession.mockResolvedValue({ data: { session: { user: { id: "owner-A" } } }, error: null });
  (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation(callback => { authChanged = callback; return { data: { subscription: { unsubscribe: mockUnsubscribe } } }; });
  rpc.mockResolvedValue({ data: [], error: null });
  browse.mockResolvedValue([person("Alice"), person("Bob")]); similar.mockResolvedValue([]); matches.mockResolvedValue({}); prompt.mockResolvedValue(false);
  search.mockResolvedValue([]); following.mockResolvedValue([]); (followUser as jest.Mock).mockResolvedValue("following"); (unfollowUser as jest.Mock).mockResolvedValue("none");
  jest.spyOn(global, "fetch").mockImplementation(() => { throw new Error("Network forbidden in People tests"); });
});
afterEach(async () => { try { if (tree) await act(async () => tree!.unmount()); expect(global.fetch).not.toHaveBeenCalled(); } finally { tree = null; jest.restoreAllMocks(); } });

test("latest search wins when responses arrive in reverse order", async () => {
  await mount(); const old = deferred<any[]>(), latest = deferred<any[]>(); search.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  await enter("old"); await enter("new"); await act(async () => latest.resolve([person("New-result")])); await act(async () => old.resolve([person("Old-result")]));
  expect(text()).toContain("New-result"); expect(text()).not.toContain("Old-result");
});
test.each(["", "a", "ab", "  ab  "])("clearing/shortening search to %p invalidates an outstanding result", async (value) => {
  await mount(); const old = deferred<any[]>(); search.mockReturnValueOnce(old.promise);
  await enter("Alice"); await enter(value); await act(async () => old.resolve([person("Stale-hit")]));
  expect(text()).not.toContain("Stale-hit"); expect(search).toHaveBeenCalledTimes(1);
});
test("search failure is not an empty result, and retry uses current query", async () => {
  await mount(); search.mockRejectedValueOnce(new Error("secret service details")); await enter("missing");
  expect(text()).toContain("Search unavailable"); expect(text()).not.toContain("No matching people found"); expect(text()).not.toContain("secret service details");
  await press("Retry search"); expect(search).toHaveBeenLastCalledWith("missing"); expect(text()).toContain("No matching people found");
});
test("late failure from an older search cannot replace newer success", async () => {
  await mount(); const old = deferred<any[]>(); search.mockReturnValueOnce(old.promise).mockResolvedValueOnce([person("Latest-hit")]);
  await enter("old"); await enter("new"); await act(async () => old.reject(new Error("old error")));
  expect(text()).toContain("Latest-hit"); expect(text()).not.toContain("Search unavailable");
});
test("auth event wins over a late initial session read", async () => {
  const initial = deferred<any>(); getSession.mockReturnValue(initial.promise); await mount(); expect(browse).not.toHaveBeenCalled();
  await auth("owner-B"); expect(browse).toHaveBeenCalledTimes(1);
  await act(async () => initial.resolve({ data: { session: { user: { id: "owner-A" } } }, error: null }));
  expect(browse).toHaveBeenCalledTimes(1);
});
test("account change clears query and rejects old search, follow status, directory and prompt responses", async () => {
  const oldDirectory = deferred<any[]>(), oldFollowing = deferred<any[]>(), oldPrompt = deferred<boolean>();
  browse.mockReturnValueOnce(oldDirectory.promise); following.mockReturnValueOnce(oldFollowing.promise); prompt.mockReturnValueOnce(oldPrompt.promise);
  await mount(); const oldSearch = deferred<any[]>(); search.mockReturnValueOnce(oldSearch.promise); await enter("old-query");
  browse.mockResolvedValue([person("New-account")]); await auth("owner-B");
  await act(async () => { oldDirectory.resolve([person("Old-directory")]); oldSearch.resolve([person("Old-search")]); oldFollowing.resolve([followed("New-account")]); oldPrompt.resolve(true); });
  expect(text()).toContain("New-account"); expect(text()).not.toContain("Old-directory"); expect(text()).not.toContain("Old-search"); expect(text()).not.toContain("Be findable here?");
  expect(action("Follow New-account").props.disabled).toBe(false);
  const input = tree!.root.findAll(n => n.props.accessibilityLabel === "Search people")[0]; expect(input.props.value).toBe("");
});
test("sign-out hides people immediately; late enrichments cannot restore them", async () => {
  const oldCompatible = deferred<any[]>(), oldMatches = deferred<any>(); similar.mockReturnValueOnce(oldCompatible.promise); matches.mockReturnValueOnce(oldMatches.promise);
  await mount(); await auth(null, "SIGNED_OUT"); await act(async () => { oldCompatible.resolve([person("Private-old")]); oldMatches.resolve({ Alice: { ready: true, score: 99 } }); });
  expect(text()).toContain("Sign in to browse people"); expect(text()).not.toContain("Alice"); expect(text()).not.toContain("Private-old");
});
test("same-account token refresh preserves the query and does not reload the screen", async () => {
  await mount(); await enter("Alice"); const calls = browse.mock.calls.length; await auth("owner-A", "TOKEN_REFRESHED");
  expect(browse).toHaveBeenCalledTimes(calls); expect(tree!.root.findAll(n => n.props.accessibilityLabel === "Search people")[0].props.value).toBe("Alice");
});
test("session errors have an honest retry state; signed-out state sends no data calls", async () => {
  getSession.mockResolvedValueOnce({ data: { session: null }, error: new Error("offline") }); await mount(); expect(text()).toContain("Couldn't check your account"); expect(browse).not.toHaveBeenCalled();
  getSession.mockResolvedValue({ data: { session: null }, error: null }); await press("Retry account"); expect(text()).toContain("Sign in to browse people"); expect(rpc).not.toHaveBeenCalled();
});
test("same-row duplicate follows are gated while another row can mutate", async () => {
  await mount(); const a = deferred<string>(), b = deferred<string>(); (followUser as jest.Mock).mockImplementation(id => id === "Alice" ? a.promise : b.promise);
  const alice = action("Follow Alice").props.onPress, bob = action("Follow Bob").props.onPress; const event = { stopPropagation: jest.fn() };
  await act(async () => { alice(event); alice(event); bob(event); bob(event); });
  expect(followUser).toHaveBeenCalledTimes(2); expect(action("Follow Alice").props.disabled).toBe(true); expect(action("Follow Bob").props.disabled).toBe(true); expect(mockPush).not.toHaveBeenCalled();
  await act(async () => a.resolve("following")); expect(action("Unfollow Alice").props.disabled).toBe(true);
  following.mockResolvedValue([followed("Alice"), followed("Bob")]); await act(async () => b.resolve("mutual"));
  expect(action("Unfollow Alice").props.disabled).toBe(false); expect(action("Unfollow Bob").props.disabled).toBe(false);
});
test("search and directory duplicates share one mutation gate", async () => {
  await mount(); search.mockResolvedValue([person("Alice")]); await enter("Alice");
  const mutation = deferred<string>(); (followUser as jest.Mock).mockReturnValue(mutation.promise);
  const buttons = tree!.root.findAll(n => n.props.accessibilityLabel === "Follow Alice" && typeof n.props.onPress === "function"); expect(buttons).toHaveLength(2);
  await act(async () => buttons.forEach(n => n.props.onPress({ stopPropagation: jest.fn() })));
  expect(followUser).toHaveBeenCalledTimes(1);
  following.mockResolvedValue([followed("Alice")]); await act(async () => mutation.resolve("following"));
});
test("unknown follow status disables actions instead of pretending not-following", async () => {
  following.mockRejectedValueOnce(new Error("offline")); await mount();
  expect(text()).toContain("Follow status unavailable"); expect(action("Follow status unavailable for Alice").props.disabled).toBe(true);
  await press("Follow status unavailable for Alice"); expect(followUser).not.toHaveBeenCalled();
  following.mockResolvedValue([followed("Alice")]); await press("Retry follow status"); expect(action("Unfollow Alice").props.disabled).toBe(false);
});
test("mutation failure is visible, reconciles ambiguous state and never exposes service details", async () => {
  await mount(); (followUser as jest.Mock).mockRejectedValueOnce(new Error("private service error")); following.mockResolvedValue([followed("Alice")]); await press("Follow Alice");
  expect(text()).toContain("Couldn't confirm the change for Alice"); expect(text()).not.toContain("private service error"); expect(action("Unfollow Alice").props.disabled).toBe(false);
});
test("old follow-status refresh cannot overwrite a completed mutation", async () => {
  await mount(); const old = deferred<any[]>(); following.mockReturnValueOnce(old.promise); await refresh();
  following.mockResolvedValue([followed("Alice")]); await press("Follow Alice"); await act(async () => old.resolve([]));
  expect(action("Unfollow Alice").props.disabled).toBe(false);
});
test("an old account mutation cannot change the new account or start a follow-up read", async () => {
  await mount(); const old = deferred<string>(); (followUser as jest.Mock).mockReturnValueOnce(old.promise); await press("Follow Alice");
  await auth("owner-B"); const reads = following.mock.calls.length; await act(async () => old.resolve("following"));
  expect(action("Follow Alice").props.disabled).toBe(false); expect(following).toHaveBeenCalledTimes(reads);
});
test("blocked identities never render in directory, search or compatible rows", async () => {
  rpc.mockResolvedValue({ data: ["Alice"], error: null }); search.mockResolvedValue([person("Alice"), person("Allowed-hit")]); similar.mockResolvedValue([person("Alice")]);
  await mount(); await enter("search"); expect(text()).not.toContain("Alice"); expect(text()).toContain("Bob"); expect(text()).toContain("Allowed-hit");
  expect(matches).toHaveBeenCalledWith(["Bob"]);
});
test.each([{ data: null, error: new Error("offline") }, { data: null, error: null }, { data: [42], error: null }])("unreadable block filter fails closed: %p", async result => {
  rpc.mockResolvedValue(result); search.mockResolvedValue([person("Alice")]); await mount(); await enter("Alice");
  expect(text()).toContain("Couldn't load people safely"); expect(text()).toContain("Search unavailable"); expect(text()).not.toContain("No matching people found");
  expect(tree!.root.findAll(n => n.props.accessibilityLabel === "Alice. Open profile.")).toHaveLength(0);
});
test("returning from a profile revalidates blocks and drops stale search/enrichment", async () => {
  await mount(); const old = deferred<any[]>(); search.mockReturnValueOnce(old.promise); await enter("Alice"); await focus(false);
  rpc.mockResolvedValue({ data: ["Alice"], error: null }); search.mockResolvedValue([person("Alice")]); await focus(true);
  await act(async () => old.resolve([person("Stale-return")])); expect(text()).not.toContain("Alice"); expect(text()).not.toContain("Stale-return"); expect(text()).toContain("Bob");
});
test("a block learned by search removes directory identity and survives late enrichment", async () => {
  const late = deferred<any[]>(); similar.mockReturnValueOnce(late.promise); await mount();
  rpc.mockResolvedValue({ data: ["Alice"], error: null }); search.mockResolvedValue([person("Alice")]); await enter("search");
  await act(async () => late.resolve([person("Alice")])); expect(text()).not.toContain("Alice");
});
test("latest directory refresh owns rows and enrichment", async () => {
  await mount(); const old = deferred<any[]>(), latest = deferred<any[]>(); browse.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  await refresh(); await refresh(); await act(async () => latest.resolve([person("Latest-directory")])); await act(async () => old.resolve([person("Old-directory")]));
  expect(text()).toContain("Latest-directory"); expect(text()).not.toContain("Old-directory");
});
test("directory and optional match failures are honest and retryable", async () => {
  browse.mockRejectedValueOnce(new Error("offline")); await mount(); expect(text()).toContain("Couldn't load people safely"); expect(text()).not.toContain("No one else is discoverable yet");
  similar.mockRejectedValueOnce(new Error("offline")); await press("Retry people"); expect(text()).toContain("Alice"); expect(text()).toContain("Some taste matches are unavailable");
});
test("discovery prompt navigates to explicit editing without making a visibility mutation", async () => {
  prompt.mockResolvedValue(true); await mount(); await press("Review profile visibility"); expect(mockPush).toHaveBeenCalledWith("/edit-profile");
  expect(rpc.mock.calls.every(([name]) => name === "hidden_user_ids")).toBe(true);
  await press("Not now"); expect(text()).not.toContain("Be findable here?");
});
test("unmount unsubscribes and suppresses pending search, auth and mutation work", async () => {
  await mount(); const pendingSearch = deferred<any[]>(), mutation = deferred<string>(); search.mockReturnValue(pendingSearch.promise); (followUser as jest.Mock).mockReturnValue(mutation.promise);
  await enter("search"); await press("Follow Alice"); const reads = following.mock.calls.length;
  await act(async () => tree!.unmount()); tree = null;
  await act(async () => { pendingSearch.resolve([person("late")]); mutation.resolve("following"); authChanged("SIGNED_IN", { user: { id: "B" } }); });
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1); expect(following).toHaveBeenCalledTimes(reads);
});

test("older compatible and score responses cannot overwrite a refreshed directory", async () => {
  const oldCompatible = deferred<any[]>(), oldScores = deferred<any>();
  similar.mockReturnValueOnce(oldCompatible.promise); matches.mockReturnValueOnce(oldScores.promise);
  await mount(); await refresh(); await act(async () => { oldCompatible.resolve([person("Old-compatible")]); oldScores.resolve({ Alice: { ready: true, score: 99 } }); });
  expect(text()).not.toContain("Old-compatible"); expect(text()).not.toContain("99% match");
});
test("blurred mutation failure cannot publish an error into the refocused session", async () => {
  await mount(); const pending = deferred<string>(); (followUser as jest.Mock).mockReturnValueOnce(pending.promise);
  await press("Follow Alice"); await focus(false); await focus(true);
  expect(action("Follow status unavailable for Bob").props.disabled).toBe(true);
  await act(async () => pending.reject(new Error("old session error")));
  expect(text()).not.toContain("Couldn't confirm the change"); expect(action("Follow Alice").props.disabled).toBe(false);
});
test("failed follow reconciliation keeps stale handlers gated until an explicit retry succeeds", async () => {
  await mount(); const captured = action("Follow Alice").props.onPress;
  following.mockRejectedValueOnce(new Error("unknown state")); await act(async () => captured({ stopPropagation: jest.fn() }));
  expect(text()).toContain("Follow status unavailable");
  await act(async () => captured({ stopPropagation: jest.fn() })); expect(followUser).toHaveBeenCalledTimes(1);
  following.mockResolvedValue([followed("Alice")]); await press("Retry follow status"); expect(action("Unfollow Alice").props.disabled).toBe(false);
});
test("A to B to A cannot let the first A mutation release the new A's gate", async () => {
  await mount(); const old = deferred<string>(); (followUser as jest.Mock).mockReturnValueOnce(old.promise); await press("Follow Alice");
  await auth("owner-B"); await auth("owner-A");
  const fresh = deferred<string>(); (followUser as jest.Mock).mockReturnValueOnce(fresh.promise); await press("Follow Alice");
  const reads = following.mock.calls.length;
  await act(async () => old.resolve("following")); expect(following).toHaveBeenCalledTimes(reads); expect(action("Follow Alice").props.disabled).toBe(true);
  following.mockResolvedValue([followed("Alice")]); await act(async () => fresh.resolve("following")); expect(action("Unfollow Alice").props.disabled).toBe(false);
});
test("captured follow and profile handlers cannot act after sign-out", async () => {
  await mount(); const follow = action("Follow Alice").props.onPress, open = action("Alice. Open profile.").props.onPress;
  await auth(null, "SIGNED_OUT"); await act(async () => { follow({ stopPropagation: jest.fn() }); open(); });
  expect(followUser).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
});
test("the same query repeated later still has a new request identity", async () => {
  await mount(); const old = deferred<any[]>(); search.mockReturnValueOnce(old.promise).mockResolvedValueOnce([]).mockResolvedValueOnce([person("Current-A")]);
  await enter("AAA"); await enter("BBB"); await enter("AAA"); await act(async () => old.resolve([person("Earlier-A")]));
  expect(text()).toContain("Current-A"); expect(text()).not.toContain("Earlier-A");
});

// Independent review: privacy also covers named errors and partial request failures.
test("newly hidden identities disappear from existing mutation errors", async () => {
  await mount();
  (followUser as jest.Mock).mockRejectedValueOnce(new Error("denied"));
  await press("Follow Alice"); expect(text()).toContain("Couldn't confirm the change for Alice");
  rpc.mockResolvedValue({ data: ["Alice"], error: null });
  await enter("somebody");
  expect(text()).not.toContain("Alice"); expect(text()).toContain("Bob");
});
test("late mutation failure cannot reintroduce a newly hidden identity in an error", async () => {
  await mount(); const mutation = deferred<string>();
  (followUser as jest.Mock).mockReturnValueOnce(mutation.promise); await press("Follow Alice");
  rpc.mockResolvedValue({ data: ["Alice"], error: null }); await enter("somebody");
  await act(async () => mutation.reject(new Error("blocked")));
  expect(text()).not.toContain("Alice"); expect(text()).toContain("Bob");
});
test.each([false, true])("a successful block read survives real search helper failure (privacy resolves late: %p)", async late => {
  await mount();
  const hidden = deferred<any>();
  search.mockImplementation(jest.requireActual("../friends").searchUsers);
  rpc.mockImplementation((name: string) => name === "hidden_user_ids"
    ? late ? hidden.promise : Promise.resolve({ data: ["Alice"], error: null })
    : Promise.resolve({ data: null, error: new Error("search service unavailable") }));
  await enter("somebody");
  if (late) await act(async () => hidden.resolve({ data: ["Alice"], error: null }));
  expect(text()).toContain("Search unavailable"); expect(text()).not.toContain("Alice"); expect(text()).toContain("Bob");
  expect(rpc).toHaveBeenCalledWith("search_users", { q: "somebody" });
});
test("a successful block read survives real directory helper failure and removes named errors", async () => {
  await mount();
  (followUser as jest.Mock).mockRejectedValueOnce(new Error("denied")); await press("Follow Alice");
  browse.mockImplementation(jest.requireActual("../social").browseProfiles);
  rpc.mockImplementation((name: string) => Promise.resolve(name === "hidden_user_ids"
    ? { data: ["Alice"], error: null } : { data: null, error: new Error("directory unavailable") }));
  await refresh();
  expect(text()).toContain("Couldn't load people safely"); expect(text()).not.toContain("Alice");
});
test("complete remount isolates old requests, auth callbacks and captured actions", async () => {
  await mount(); const oldSearch = deferred<any[]>(); search.mockReturnValueOnce(oldSearch.promise); await enter("old-query");
  const oldAuth = authChanged, oldFollow = action("Follow Alice").props.onPress;
  await act(async () => tree!.unmount()); tree = null;
  browse.mockResolvedValue([person("New-mount")]); await mount();
  await act(async () => { oldSearch.resolve([person("Old-mount")]); oldAuth("SIGNED_OUT", null); oldFollow({ stopPropagation: jest.fn() }); });
  expect(text()).toContain("New-mount"); expect(text()).not.toContain("Old-mount"); expect(text()).not.toContain("Sign in to browse people");
  expect(followUser).not.toHaveBeenCalled();
});
test("real following helper maps snake-case RPC rows and reconciliation follows the server", async () => {
  following.mockImplementation(jest.requireActual("../friends").listFollowing);
  (unfollowUser as jest.Mock).mockImplementation(jest.requireActual("../friends").unfollowUser);
  let youFollow = true;
  rpc.mockImplementation((name: string) => {
    if (name === "unfollow_user") { youFollow = false; return Promise.resolve({ data: "follows_you", error: null }); }
    if (name === "list_follows") return Promise.resolve({ data: youFollow ? [{ id: "Alice", display_name: "Alice", you_follow: true, follows_you: true }] : [], error: null });
    return Promise.resolve({ data: [], error: null });
  });
  await mount(); expect(action("Unfollow Alice").props.disabled).toBe(false);
  await press("Unfollow Alice"); expect(action("Follow Alice").props.disabled).toBe(false);
  expect(rpc).toHaveBeenCalledWith("list_follows", { p_kind: "following" });
  expect(rpc).toHaveBeenCalledWith("unfollow_user", { target: "Alice" });
});

test("late privacy success from a failed superseded search cannot affect the new query", async () => {
  await mount(); const oldPrivacy = deferred<any>();
  rpc.mockReturnValueOnce(oldPrivacy.promise).mockResolvedValue({ data: [], error: null });
  search.mockRejectedValueOnce(new Error("old request failed")).mockResolvedValueOnce([person("Current-query")]);
  await enter("old-query"); await enter("new-query");
  await act(async () => oldPrivacy.resolve({ data: ["Bob", "Current-query"], error: null }));
  expect(text()).toContain("Current-query"); expect(text()).toContain("Bob"); expect(text()).not.toContain("Search unavailable");
});
test("late privacy success from a failed old-account search cannot filter the new account", async () => {
  await mount(); const oldPrivacy = deferred<any>();
  rpc.mockReturnValueOnce(oldPrivacy.promise).mockResolvedValue({ data: [], error: null });
  search.mockRejectedValueOnce(new Error("old account failure")); await enter("old-query");
  await auth("owner-B");
  await act(async () => oldPrivacy.resolve({ data: ["Bob"], error: null }));
  expect(text()).toContain("Bob"); expect(text()).not.toContain("Search unavailable");
});
