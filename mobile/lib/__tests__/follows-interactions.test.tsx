import React from "react";
import { Alert, RefreshControl } from "react-native";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
const { create, act } = require("react-test-renderer");
import FollowsScreen from "../../app/follows";
import { ProfileBody } from "../../components/ProfileBody";
import { listFollowers, listFollowing, listFriends, followUser, unfollowUser, type FollowListItem } from "../friends";
import { getFriendProfileSnapshot } from "../profile";
import { reportContent } from "../moderation";

let mockParams: Record<string, unknown> = {};
let mockFocused = true;
const mockPush = jest.fn(), mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void | (() => void)) => require("react").useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]),
  Stack: { Screen: () => null },
}));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("../friends", () => ({
  ...jest.requireActual("../friends"),
  listFollowers: jest.fn(), listFollowing: jest.fn(), listFriends: jest.fn(), followUser: jest.fn(), unfollowUser: jest.fn(),
}));
jest.mock("../profile", () => ({ getFriendProfileSnapshot: jest.fn(), getMyProfile: async () => null }));
jest.mock("../social", () => ({ loadSharedPlaces: async () => [], openInstagram: jest.fn(), openTikTok: jest.fn() }));
jest.mock("../palate/pairCompatibility", () => ({ loadPalateMatch: async () => null }));
jest.mock("../recommendation/palate-match", () => ({ matchHeadline: () => "" }));
jest.mock("../palate", () => ({ displayStoredPersona: () => null }));
jest.mock("../observability", () => ({ captureError: jest.fn() }));
jest.mock("../moderation", () => ({ reportContent: jest.fn(), blockUser: jest.fn(), unblockUser: jest.fn(), isBlocked: async () => false, REPORT_REASONS: [{ key: "spam", label: "Spam" }] }));
jest.mock("react-native-view-shot", () => ({ captureRef: jest.fn() }));
jest.mock("../../components/Avatar", () => ({ Avatar: () => null }));
jest.mock("../../components/FriendsInCities", () => ({ FriendsInCities: () => null }));
jest.mock("../../components/InviteCard", () => ({ InviteCard: () => null }));
jest.mock("../../components/ForwardReceiptsCard", () => ({ ForwardReceiptsCard: () => null }));
jest.mock("../../components/RateVisitsCard", () => ({ RateVisitsCard: () => null }));
jest.mock("../../components/TopFive", () => ({ TopFive: () => null }));
jest.mock("../../components/PalateMatches", () => ({ PalateMatches: () => null }));
jest.mock("../../components/SavedNearbyCard", () => ({ SavedNearbyCard: () => null }));
jest.mock("../../components/MatchShareCard", () => ({ MatchShareCard: () => null }));
jest.mock("../../components/ProfileColumns", () => ({ ProfileColumns: () => null }));
jest.mock("../../components/SocialGlyph", () => ({ InstagramGlyph: () => null, TikTokGlyph: () => null }));
jest.mock("../../components/Button", () => ({ Spacer: () => null }));

let tree: ReactTestRenderer | null = null;
const followers = listFollowers as jest.Mock, following = listFollowing as jest.Mock, friends = listFriends as jest.Mock;
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function row(id: string, youFollow = false, followsYou = true): FollowListItem {
  return { friend: { id, display_name: id, username: null, avatar_url: null, email: null, profile_visibility: "public" }, youFollow, followsYou, since: null };
}
function textOf(node: ReactTestInstance): string { return node.children.map(c => typeof c === "string" ? c : textOf(c)).join(""); }
function contents() { return textOf(tree!.root); }
function action(label: string) {
  const nodes = tree!.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === "function");
  expect(nodes).toHaveLength(1); return nodes[0];
}
async function press(label: string) { await act(async () => { action(label).props.onPress(); }); }
async function mount(element: React.ReactElement = <FollowsScreen />) { await act(async () => { tree = create(element); }); }
async function refresh() {
  const control = tree!.root.findAll(n => n.props.refreshControl?.type === RefreshControl)[0].props.refreshControl;
  await act(async () => { control.props.onRefresh(); });
}
async function focus(value: boolean) { mockFocused = value; await act(async () => { tree!.update(<FollowsScreen />); }); }

beforeEach(() => {
  jest.resetAllMocks(); mockParams = {}; mockFocused = true;
  followers.mockResolvedValue([]); following.mockResolvedValue([]); friends.mockResolvedValue([]);
  (followUser as jest.Mock).mockResolvedValue("mutual"); (unfollowUser as jest.Mock).mockResolvedValue("follows_you");
  (reportContent as jest.Mock).mockResolvedValue(undefined);
  jest.spyOn(global, "fetch").mockImplementation(() => { throw new Error("Network forbidden"); });
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(async () => { try { if (tree) await act(async () => tree!.unmount()); expect(global.fetch).not.toHaveBeenCalled(); } finally { tree = null; jest.restoreAllMocks(); } });

test.each(["someone-else", "fixture-owner", "", ["someone-else"]])("explicit user route %p never fetches the caller list", async (user) => {
  mockParams = { user, tab: "friends" }; await mount();
  expect(contents()).toContain("Profile-specific connection lists");
  expect(followers).not.toHaveBeenCalled(); expect(following).not.toHaveBeenCalled(); expect(friends).not.toHaveBeenCalled();
  await press("Open my connections"); expect(mockReplace).toHaveBeenCalledWith("/follows?tab=friends");
  mockParams = { tab: "friends" }; await act(async () => { tree!.update(<FollowsScreen />); });
  expect(friends).toHaveBeenCalledTimes(1);
});
test.each([undefined, "invalid", ["friends"]])("invalid tab %p falls back to followers", async (tab) => {
  mockParams = { tab }; await mount(); expect(followers).toHaveBeenCalledTimes(1); expect(friends).not.toHaveBeenCalled();
  expect(action("Followers").props.accessibilityState.selected).toBe(true);
});
test("late tab A success and failure cannot replace the latest tab", async () => {
  const a = deferred<FollowListItem[]>(), b = deferred<FollowListItem[]>();
  followers.mockReturnValueOnce(a.promise); following.mockReturnValueOnce(b.promise); friends.mockResolvedValue([row("current-C")]);
  await mount(); await press("Following"); await press("Friends");
  await act(async () => a.resolve([row("stale-A")])); await act(async () => b.reject(new Error("stale-B-error")));
  expect(contents()).toContain("current-C"); expect(contents()).not.toContain("stale-A"); expect(contents()).not.toContain("Couldn't load this list");
  expect(action("Friends").props.accessibilityState.selected).toBe(true);
});
test("newer refresh wins over older refresh", async () => {
  followers.mockResolvedValueOnce([row("initial")]); await mount();
  const old = deferred<FollowListItem[]>(), latest = deferred<FollowListItem[]>();
  followers.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  await refresh(); await refresh(); await act(async () => latest.resolve([row("latest")])); await act(async () => old.resolve([row("obsolete")]));
  expect(contents()).toContain("latest"); expect(contents()).not.toContain("obsolete");
});
test("same-tick duplicate toggles are gated per row, not globally", async () => {
  followers.mockResolvedValue([row("Alice"), row("Bob", true)]); await mount();
  const a = deferred<string>(), b = deferred<string>();
  (followUser as jest.Mock).mockReturnValue(a.promise); (unfollowUser as jest.Mock).mockReturnValue(b.promise);
  const first = action("Follow Alice"), second = action("Unfollow Bob");
  await act(async () => { first.props.onPress(); first.props.onPress(); second.props.onPress(); second.props.onPress(); });
  expect(followUser).toHaveBeenCalledTimes(1); expect(unfollowUser).toHaveBeenCalledTimes(1); expect(mockPush).not.toHaveBeenCalled();
  expect(action("Follow Alice").props.disabled).toBe(true); expect(action("Unfollow Bob").props.disabled).toBe(true);
  await act(async () => a.resolve("mutual")); expect(action("Follow Alice").props.disabled).toBe(true);
  followers.mockResolvedValue([row("Alice", true), row("Bob", false)]);
  await act(async () => b.resolve("follows_you")); expect(action("Unfollow Alice").props.disabled).toBe(false); expect(action("Follow Bob").props.disabled).toBe(false);
});
test("mutation completion reloads the latest tab and cannot restore its original tab", async () => {
  followers.mockResolvedValue([row("Alice")]); friends.mockResolvedValue([row("current-friend", true)]); await mount();
  const pending = deferred<string>(); (followUser as jest.Mock).mockReturnValue(pending.promise);
  await press("Follow Alice"); await press("Friends"); expect(friends).not.toHaveBeenCalled();
  await act(async () => pending.resolve("mutual"));
  expect(friends).toHaveBeenCalledTimes(1); expect(followers).toHaveBeenCalledTimes(1); expect(contents()).toContain("current-friend");
  expect(action("Friends").props.accessibilityState.selected).toBe(true);
});
test("visible mutation failure reconciles and allows retry without optimistic lies", async () => {
  followers.mockResolvedValue([row("Alice")]); await mount();
  (followUser as jest.Mock).mockRejectedValueOnce(new Error("service details")); await press("Follow Alice");
  expect(contents()).toContain("Couldn't follow Alice. Please try again."); expect(contents()).not.toContain("service details");
  expect(action("Follow Alice").props.disabled).toBe(false);
  followers.mockResolvedValue([row("Alice", true)]); await press("Follow Alice");
  expect(contents()).not.toContain("Couldn't follow Alice"); expect(action("Unfollow Alice").props.disabled).toBe(false);
});
test("blur/refocus suppresses old errors and snapshots, even on the same tab", async () => {
  followers.mockResolvedValueOnce([row("Alice")]); await mount();
  const mutation = deferred<string>(); (followUser as jest.Mock).mockReturnValue(mutation.promise);
  await press("Follow Alice"); await focus(false); await focus(true);
  followers.mockResolvedValue([row("fresh-session")]);
  await act(async () => mutation.reject(new Error("old-session failure")));
  expect(contents()).toContain("fresh-session"); expect(contents()).not.toContain("Couldn't follow Alice");
});
test("stale blur load cannot overwrite a refocused result", async () => {
  const old = deferred<FollowListItem[]>(); followers.mockReturnValueOnce(old.promise).mockResolvedValue([row("refocused")]);
  await mount(); await focus(false); await focus(true); await act(async () => old.resolve([row("old-session")]));
  expect(contents()).toContain("refocused"); expect(contents()).not.toContain("old-session");
});
test("route change to an explicit user never leaks a pending owner result", async () => {
  const old = deferred<FollowListItem[]>(); followers.mockReturnValueOnce(old.promise); await mount();
  mockParams = { user: "foreign" }; await act(async () => { tree!.update(<FollowsScreen />); });
  await act(async () => old.resolve([row("owner-only-name")]));
  expect(contents()).not.toContain("owner-only-name"); expect(contents()).toContain("Profile-specific connection lists");
});

function snapshot(mine: boolean) {
  return { id: "target", display_name: "Fixture", username: null, avatar_url: null, profile_visibility: "public", persona_label: null, persona_tagline: null, total_visits: 0, unique_restaurants: 0, is_self: mine, is_friend: false, follow_state: mine ? "self" : "none", followers_count: 7, following_count: 8, friends_count: 3, hidden_visits: 0 };
}
test("mounted owner counts navigate without target user params", async () => {
  (getFriendProfileSnapshot as jest.Mock).mockResolvedValue(snapshot(true)); await mount(<ProfileBody targetId="target" />);
  for (const [tab, count] of [["followers", 7], ["following", 8], ["friends", 3]] as const) {
    await press(`${count} ${tab}. Open your ${tab}.`);
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/follows", params: { tab } });
  }
  expect(mockPush).toHaveBeenCalledTimes(3);
});
test("mounted other-user counts are static accessible text, never buttons", async () => {
  (getFriendProfileSnapshot as jest.Mock).mockResolvedValue(snapshot(false)); await mount(<ProfileBody targetId="target" />);
  for (const label of ["7 followers", "8 following", "3 friends"]) {
    const nodes = tree!.root.findAll(n => n.props.accessibilityLabel === label);
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) { expect(node.props.onPress).toBeUndefined(); expect(node.props.accessibilityRole).not.toBe("button"); }
  }
  expect(mockPush).not.toHaveBeenCalled();
});
test("report confirmation contains no promised response deadline", async () => {
  (getFriendProfileSnapshot as jest.Mock).mockResolvedValue(snapshot(false)); await mount(<ProfileBody targetId="target" />);
  const report = tree!.root.findAll(n => typeof n.props.onPress === "function" && textOf(n) === "Report")[0];
  await act(async () => { report.props.onPress(); });
  const options = (Alert.alert as jest.Mock).mock.calls[0][2];
  await act(async () => { await options.find((option: { text: string }) => option.text === "Spam").onPress(); });
  expect(reportContent).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenLastCalledWith("Thanks for flagging", "Your report has been submitted.");
});

test("successful mutation stays gated until reconciliation, including captured handlers", async () => {
  followers.mockResolvedValueOnce([row("Alice")]); await mount();
  const mutation = deferred<string>(), reload = deferred<FollowListItem[]>();
  (followUser as jest.Mock).mockReturnValue(mutation.promise); followers.mockReturnValue(reload.promise);
  const captured = action("Follow Alice").props.onPress;
  await act(async () => { captured(); });
  await act(async () => mutation.resolve("mutual"));
  await act(async () => { captured(); });
  expect(followUser).toHaveBeenCalledTimes(1);
  await act(async () => reload.resolve([row("Alice", true)]));
  expect(action("Unfollow Alice").props.disabled).toBe(false);
});
test("uncertain mutation and failed reconciliation require a fresh read before retrying", async () => {
  followers.mockResolvedValueOnce([row("Alice")]); await mount();
  (followUser as jest.Mock).mockRejectedValueOnce(new Error("lost reply"));
  followers.mockRejectedValueOnce(new Error("reload unavailable"));
  const captured = action("Follow Alice").props.onPress; await act(async () => { captured(); });
  expect(contents()).toContain("Couldn't follow Alice"); expect(contents()).toContain("Couldn't load this list");
  await act(async () => { captured(); }); expect(followUser).toHaveBeenCalledTimes(1);
  // The server may have committed even though its first reply was lost.
  followers.mockResolvedValue([row("Alice", true)]); await press("Try again");
  expect(action("Unfollow Alice").props.disabled).toBe(false);
});
test("a mutation resolving after unmount does not start another list request", async () => {
  followers.mockResolvedValue([row("Alice")]); await mount();
  const mutation = deferred<string>(); (followUser as jest.Mock).mockReturnValue(mutation.promise);
  await press("Follow Alice"); await act(async () => { tree!.unmount(); }); tree = null;
  await act(async () => mutation.resolve("mutual")); expect(followers).toHaveBeenCalledTimes(1);
});
test("a pre-mutation refresh cannot restore an outdated relationship", async () => {
  followers.mockResolvedValueOnce([row("Alice")]); await mount();
  const captured = action("Follow Alice").props.onPress, stale = deferred<FollowListItem[]>(), mutation = deferred<string>();
  followers.mockReturnValueOnce(stale.promise).mockResolvedValue([row("Alice", true)]);
  (followUser as jest.Mock).mockReturnValue(mutation.promise);
  await refresh(); await act(async () => { captured(); });
  await act(async () => mutation.resolve("mutual")); await act(async () => stale.resolve([row("Alice")]));
  expect(action("Unfollow Alice").props.disabled).toBe(false);
});

async function route(params: Record<string, unknown>) {
  mockParams = params;
  await act(async () => { tree!.update(<FollowsScreen />); });
}

test("route-tab transition preserves pending row gates and reconciles the destination", async () => {
  followers.mockResolvedValue([row("Alice")]); following.mockResolvedValue([row("Alice", true)]); await mount();
  const pending = deferred<string>(); (followUser as jest.Mock).mockReturnValue(pending.promise);
  const captured = action("Follow Alice").props.onPress;
  await act(async () => { captured(); });
  await route({ tab: "following" });
  expect(following).not.toHaveBeenCalled();
  await act(async () => { captured(); });
  expect(followUser).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve("mutual"));
  expect(following).toHaveBeenCalledTimes(1);
  expect(action("Following").props.accessibilityState.selected).toBe(true);
  expect(action("Unfollow Alice").props.disabled).toBe(false);
});

test("route A to B to A retains mutation ownership instead of reopening the gate", async () => {
  followers.mockResolvedValueOnce([row("Alice")]).mockResolvedValue([row("Alice", true)]); await mount();
  const pending = deferred<string>(); (followUser as jest.Mock).mockReturnValue(pending.promise);
  const captured = action("Follow Alice").props.onPress;
  await act(async () => { captured(); });
  await route({ tab: "following" }); await route({ tab: "followers" });
  await act(async () => { captured(); });
  expect(followUser).toHaveBeenCalledTimes(1); expect(following).not.toHaveBeenCalled();
  expect(followers).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve("mutual"));
  expect(followers).toHaveBeenCalledTimes(2); expect(action("Unfollow Alice").props.disabled).toBe(false);
});

test.each([true, false])("unsupported target performs no caller reads when pending mutation settles (success=%s)", async (success) => {
  followers.mockResolvedValue([row("Alice")]); await mount();
  const pending = deferred<string>(); (followUser as jest.Mock).mockReturnValue(pending.promise);
  const captured = action("Follow Alice").props.onPress;
  await act(async () => { captured(); });
  await route({ user: "foreign", tab: "friends" });
  await act(async () => { captured(); });
  await act(async () => { if (success) pending.resolve("mutual"); else pending.reject(new Error("old failure")); });
  expect(followUser).toHaveBeenCalledTimes(1);
  expect(followers).toHaveBeenCalledTimes(1); expect(friends).not.toHaveBeenCalled(); expect(following).not.toHaveBeenCalled();
  expect(contents()).toContain("Profile-specific connection lists"); expect(contents()).not.toContain("Couldn't follow Alice");
  friends.mockResolvedValue([row("Alice", true)]);
  await route({ tab: "friends" });
  expect(friends).toHaveBeenCalledTimes(1); expect(action("Unfollow Alice").props.disabled).toBe(false);
});

test("owner to unsupported target to owner waits for all outstanding row mutations", async () => {
  followers.mockResolvedValue([row("Alice"), row("Bob")]); await mount();
  const a = deferred<string>(), b = deferred<string>();
  (followUser as jest.Mock).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  await press("Follow Alice"); await press("Follow Bob");
  await route({ user: "foreign" }); await route({ tab: "friends" });
  await act(async () => a.resolve("mutual")); expect(friends).not.toHaveBeenCalled();
  friends.mockResolvedValue([row("Alice", true), row("Bob", true)]);
  await act(async () => b.resolve("mutual")); expect(friends).toHaveBeenCalledTimes(1);
  expect(action("Unfollow Alice").props.disabled).toBe(false); expect(action("Unfollow Bob").props.disabled).toBe(false);
});

test("failed destination reconciliation retains gates until a successful retry", async () => {
  followers.mockResolvedValue([row("Alice")]); await mount();
  const pending = deferred<string>(); (followUser as jest.Mock).mockReturnValue(pending.promise);
  const captured = action("Follow Alice").props.onPress;
  await act(async () => { captured(); }); await route({ tab: "friends" });
  friends.mockRejectedValueOnce(new Error("unavailable")); await act(async () => pending.resolve("mutual"));
  expect(contents()).toContain("Couldn't load this list");
  await act(async () => { captured(); }); expect(followUser).toHaveBeenCalledTimes(1);
  friends.mockResolvedValue([row("Alice", true)]); await press("Try again");
  expect(action("Unfollow Alice").props.disabled).toBe(false);
});

test("local tabs remain selected on unchanged route rerenders", async () => {
  await mount(); await press("Friends"); await route({});
  expect(action("Friends").props.accessibilityState.selected).toBe(true);
  expect(friends).toHaveBeenCalledTimes(1);
});

test.each([true, false])("old target snapshot cannot publish success/error into the next target (success=%s)", async (success) => {
  const old = deferred<ReturnType<typeof snapshot>>();
  (getFriendProfileSnapshot as jest.Mock).mockReturnValueOnce(old.promise).mockResolvedValue({ ...snapshot(false), id: "B", display_name: "Current B" });
  await mount(<ProfileBody targetId="A" />);
  await act(async () => { tree!.update(<ProfileBody targetId="B" />); });
  expect(contents()).toContain("Current B");
  await act(async () => { if (success) old.resolve({ ...snapshot(true), id: "A", display_name: "Old A" }); else old.reject(new Error("Old target error")); });
  expect(contents()).toContain("Current B"); expect(contents()).not.toContain("Old A"); expect(contents()).not.toContain("Old target error");
  expect(tree!.root.findAll(n => n.props.accessibilityLabel === "7 followers. Open your followers.")).toHaveLength(0);
});

test("old target completion cannot dismiss the current target loading state", async () => {
  const a = deferred<ReturnType<typeof snapshot>>(), b = deferred<ReturnType<typeof snapshot>>();
  (getFriendProfileSnapshot as jest.Mock).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  await mount(<ProfileBody targetId="A" />); await act(async () => { tree!.update(<ProfileBody targetId="B" />); });
  await act(async () => a.resolve({ ...snapshot(true), id: "A", display_name: "Old A" }));
  expect(contents()).not.toContain("Old A"); expect(contents()).not.toContain("Profile not found");
  await act(async () => b.resolve({ ...snapshot(false), id: "B", display_name: "Current B" }));
  expect(contents()).toContain("Current B");
});

test("profile A to B to A rejects the first A request session", async () => {
  const old = deferred<ReturnType<typeof snapshot>>();
  (getFriendProfileSnapshot as jest.Mock).mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ ...snapshot(false), id: "B", display_name: "B" })
    .mockResolvedValueOnce({ ...snapshot(true), id: "A", display_name: "Fresh A" });
  await mount(<ProfileBody targetId="A" />); await act(async () => { tree!.update(<ProfileBody targetId="B" />); });
  await act(async () => { tree!.update(<ProfileBody targetId="A" />); });
  await act(async () => old.resolve({ ...snapshot(false), id: "A", display_name: "Obsolete A" }));
  expect(contents()).toContain("Fresh A"); expect(contents()).not.toContain("Obsolete A");
});

test("same-target refocus rejects an older snapshot without remounting", async () => {
  const old = deferred<ReturnType<typeof snapshot>>();
  (getFriendProfileSnapshot as jest.Mock).mockReturnValueOnce(old.promise)
    .mockResolvedValue({ ...snapshot(false), display_name: "Refocused profile" });
  await mount(<ProfileBody targetId="target" />);
  mockFocused = false; await act(async () => { tree!.update(<ProfileBody targetId="target" />); });
  mockFocused = true; await act(async () => { tree!.update(<ProfileBody targetId="target" />); });
  await act(async () => old.resolve({ ...snapshot(true), display_name: "Pre-blur profile" }));
  expect(contents()).toContain("Refocused profile"); expect(contents()).not.toContain("Pre-blur profile");
});

test("old target mutation completion cannot start a stale profile reload", async () => {
  (getFriendProfileSnapshot as jest.Mock)
    .mockResolvedValueOnce({ ...snapshot(false), id: "A", display_name: "Original A" })
    .mockResolvedValue({ ...snapshot(false), id: "B", display_name: "Current B" });
  await mount(<ProfileBody targetId="A" />);
  const pending = deferred<string>(); (followUser as jest.Mock).mockReturnValue(pending.promise);
  const follow = tree!.root.findAll(n => typeof n.props.onPress === "function" && textOf(n) === "Follow")[0];
  await act(async () => { void follow.props.onPress(); });
  await act(async () => { tree!.update(<ProfileBody targetId="B" />); });
  await act(async () => pending.resolve("mutual"));
  expect(getFriendProfileSnapshot).toHaveBeenCalledTimes(2);
  expect(contents()).toContain("Current B"); expect(contents()).not.toContain("Original A");
});

// Original independent-review regressions: now green with this patch.
test("REVIEW route-key remount must retain an in-flight row gate", async () => {
  followers.mockResolvedValue([row("Alice")]); following.mockResolvedValue([row("Alice")]); await mount();
  const pending = deferred<string>(); (followUser as jest.Mock).mockReturnValue(pending.promise);
  await press("Follow Alice");
  mockParams = { tab: "following" }; await act(async () => tree!.update(<FollowsScreen />));
  const next = tree!.root.findAll(n => n.props.accessibilityLabel === "Follow Alice" && typeof n.props.onPress === "function");
  if (next.length && !next[0].props.disabled) await press("Follow Alice");
  expect(followUser).toHaveBeenCalledTimes(1);
});
test("REVIEW old mutation must reconcile a route-remounted list", async () => {
  followers.mockResolvedValue([row("Alice")]); following.mockResolvedValue([row("Alice")]); await mount();
  const pending = deferred<string>(); (followUser as jest.Mock).mockReturnValue(pending.promise);
  await press("Follow Alice");
  mockParams = { tab: "following" }; await act(async () => tree!.update(<FollowsScreen />));
  following.mockResolvedValue([row("Alice", true)]);
  await act(async () => pending.resolve("mutual"));
  expect(contents()).toContain("Friends");
  expect(tree!.root.findAll(n => n.props.accessibilityLabel === "Unfollow Alice" && typeof n.props.onPress === "function")).toHaveLength(1);
});
test("REVIEW late previous target snapshot must not overwrite current profile", async () => {
  const first = deferred<ReturnType<typeof snapshot>>();
  (getFriendProfileSnapshot as jest.Mock).mockReturnValueOnce(first.promise).mockResolvedValue({...snapshot(false),id:"B",display_name:"Current B"});
  await mount(<ProfileBody targetId="A" />);
  await act(async () => tree!.update(<ProfileBody targetId="B" />));
  expect(contents()).toContain("Current B");
  await act(async () => first.resolve({...snapshot(true),id:"A",display_name:"Old A"}));
  expect(contents()).toContain("Current B"); expect(contents()).not.toContain("Old A");
});
