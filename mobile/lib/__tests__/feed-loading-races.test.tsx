import React from "react";
import { Alert, RefreshControl } from "react-native";
import FeedTab from "../../app/(tabs)/feed";
import { supabase } from "../supabase";
import { blockUser, reportContent } from "../moderation";
import { listFeed, toggleLike } from "../feed";
import { assembleGraph } from "../recommendation";
import { computeTasteVector } from "../taste-vector";
const { create, act } = require("react-test-renderer");
let mockFocused = true;
jest.mock("../supabase", () => ({ supabase: { auth: { getUser: jest.fn() } } }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), useFocusEffect: (callback: any) => require("react").useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]) }));
jest.mock("../feed", () => ({ listFeed: jest.fn(), toggleLike: jest.fn() }));
jest.mock("../taste-vector", () => ({ computeTasteVector: jest.fn() }));
jest.mock("../personal-signal", () => ({ loadPersonalSignal: async () => null }));
jest.mock("../recommendation", () => ({ assembleGraph: jest.fn(() => null), getCompatibility: () => ({ score: 50 }) }));
jest.mock("../palate-insights", () => ({ addToWishlist: jest.fn() }));
jest.mock("../haptics", () => ({ triggerHapticSuccess: jest.fn() }));
jest.mock("../moderation", () => ({ reportContent: jest.fn(), blockUser: jest.fn(), REPORT_REASONS: [{key: "spam", label: "Spam"}] }));
jest.mock("../../components/HypeMap", () => ({ HypeMap: () => null }));
jest.mock("../../components/FeedAvatar", () => ({ FeedAvatar: () => null }));
jest.mock("../../components/PlaceArt", () => ({ cuisineHue: () => "#222222" }));
jest.mock("../../components/CommentsSheet", () => ({ CommentsSheet: (props: any) => require("react").createElement("CommentsSheet", props) }));
jest.mock("../../components/HeartButton", () => ({ HeartBurst: () => null, HeartButton: (props: any) => require("react").createElement("Heart", props) }));
function deferred() { let resolve!: (v: any) => void, reject!: (e: Error) => void; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function row(id: string) { return { id, user_id: id, kind: "visit_logged", payload: { restaurant_name: id }, created_at: new Date().toISOString(), user: { display_name: id }, topComments: [], likeCount: 0, iLiked: false, commentCount: 0, restaurant: null }; }
let tree: any;
const contents = () => JSON.stringify(tree.toJSON(), (key, value) => key === "_owner" || key === "refreshControl" ? undefined : value);
const refresh = () => tree.root.findByType(RefreshControl).props;
const sheet = () => tree.root.findByType("CommentsSheet").props;
const heart = () => tree.root.findAllByType("Heart")[0].props;
async function mount() { await act(async () => { tree = create(<FeedTab />); }); }
async function focus(value: boolean) { mockFocused = value; await act(async () => tree.update(<FeedTab />)); }
async function startRefresh() { await act(async () => refresh().onRefresh()); }
beforeEach(() => { jest.resetAllMocks(); (supabase.auth.getUser as jest.Mock).mockResolvedValue({data: {user: {id: "owner"}}, error: null}); mockFocused = true; (computeTasteVector as jest.Mock).mockResolvedValue(null); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
test("old focus success cannot overwrite a newer focus snapshot", async () => {
 const old = deferred(), current = deferred(); (listFeed as jest.Mock).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
 await mount(); await focus(false); await focus(true); await act(async () => current.resolve([row("current-row")])); await act(async () => old.resolve([row("stale-row")]));
 expect(contents()).toContain("current-row"); expect(contents()).not.toContain("stale-row"); expect(computeTasteVector).toHaveBeenCalledTimes(1);
});
test("old failure cannot publish an error or release a newer read gate", async () => {
 const old = deferred(), current = deferred(); (listFeed as jest.Mock).mockResolvedValueOnce([row("saved-row")]).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
 await mount(); await startRefresh(); await focus(false); await focus(true); await act(async () => old.reject(new Error("stale")));
 expect(contents()).not.toContain("Couldn't refresh"); await startRefresh(); expect(listFeed).toHaveBeenCalledTimes(3);
 await act(async () => current.resolve([row("new-row")])); expect(refresh().refreshing).toBe(false);
});
test("refresh failure retains content and offers an accessible retry", async () => {
 (listFeed as jest.Mock).mockResolvedValueOnce([row("saved-row")]).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([row("recovered-row")]);
 await mount(); await startRefresh(); expect(contents()).toContain("saved-row"); expect(contents()).toContain("Couldn't refresh your feed");
 const retry = tree.root.findAll((n: any) => n.props.accessibilityLabel === "Retry feed" && n.props.onPress)[0]; expect(retry.props.accessibilityRole).toBe("button");
 await act(async () => retry.props.onPress()); expect(contents()).toContain("recovered-row"); expect(contents()).not.toContain("Couldn't refresh");
});
test("initial retry clears error, stays loading and gates duplicate callbacks", async () => {
 const pending = deferred(); (listFeed as jest.Mock).mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(pending.promise);
 await mount(); const retry = tree.root.findAll((n: any) => n.props.onPress && n.props.accessibilityLabel === "Retry feed")[0];
 await act(async () => { retry.props.onPress(); retry.props.onPress(); }); expect(listFeed).toHaveBeenCalledTimes(2);
 expect(contents()).toContain("Loading your feed"); expect(contents()).not.toContain("Couldn't load"); expect(contents()).not.toContain("first story");
 await act(async () => pending.resolve([])); expect(contents()).toContain("first story");
});
test.each(["blur", "unmount"])("late load after %s does not start enrichment", async mode => {
 const pending = deferred(); (listFeed as jest.Mock).mockReturnValueOnce(pending.promise); await mount();
 if (mode === "blur") await focus(false); else { await act(async () => tree.unmount()); tree = null; }
 await act(async () => pending.resolve([row("late-row")])); expect(computeTasteVector).not.toHaveBeenCalled(); if (tree) expect(contents()).not.toContain("late-row");
});
test("same-tick refresh is one request", async () => {
 const pending = deferred(); (listFeed as jest.Mock).mockResolvedValueOnce([row("saved-row")]).mockReturnValue(pending.promise); await mount(); const callback = refresh().onRefresh;
 await act(async () => { callback(); callback(); }); expect(listFeed).toHaveBeenCalledTimes(2); await act(async () => pending.resolve([]));
});
test("block completion during refresh is not undone by its older snapshot", async () => {
 const pending = deferred(); (listFeed as jest.Mock).mockResolvedValueOnce([row("blocked-row"), row("keep-row")]).mockReturnValueOnce(pending.promise);
 await mount(); await startRefresh(); await act(async () => sheet().onBlockedUser("blocked-row")); await act(async () => pending.resolve([row("blocked-row"), row("keep-row")]));
 expect(contents()).not.toContain("blocked-row"); expect(contents()).toContain("keep-row");
});
test("sheet count received during refresh survives its older snapshot", async () => {
 const pending = deferred(); (listFeed as jest.Mock).mockResolvedValueOnce([row("saved-row")]).mockReturnValueOnce(pending.promise); await mount(); await startRefresh();
 await act(async () => sheet().onCountChange("saved-row", 7)); await act(async () => pending.resolve([row("saved-row")])); expect(contents()).toContain("7 comments");
});
test("like ownership survives blur and stale refresh", async () => {
 const pending = deferred(), like = deferred(); (listFeed as jest.Mock).mockResolvedValueOnce([row("saved-row")]).mockReturnValueOnce(pending.promise); (toggleLike as jest.Mock).mockReturnValueOnce(like.promise);
 await mount(); const callback = heart().onToggle; await act(async () => { void callback(); void callback(); }); expect(toggleLike).toHaveBeenCalledTimes(1);
 await focus(false); await focus(true); expect(heart().disabled).toBe(true); await act(async () => pending.resolve([row("saved-row")])); expect(heart().liked).toBe(true);
 await act(async () => like.resolve(undefined)); expect(heart().disabled).toBe(false);
});

test("late enrichment from an older focus cannot assemble or publish its graph", async () => {
 const graph = deferred(); (computeTasteVector as jest.Mock).mockReturnValueOnce(graph.promise).mockResolvedValueOnce(null);
 (listFeed as jest.Mock).mockResolvedValue([row("saved-row")]); await mount(); await focus(false); await focus(true);
 expect(assembleGraph).toHaveBeenCalledTimes(1);
 await act(async () => graph.resolve({ stale: true })); expect(assembleGraph).toHaveBeenCalledTimes(1);
});
test("current refresh spinner remains owned until its request settles", async () => {
 const pending = deferred(); (listFeed as jest.Mock).mockResolvedValueOnce([row("saved-row")]).mockReturnValueOnce(pending.promise);
 await mount(); await startRefresh(); expect(refresh().refreshing).toBe(true);
 await act(async () => pending.reject(new Error("offline"))); expect(refresh().refreshing).toBe(false);
 expect(contents()).toContain("Couldn't refresh your feed");
});

// Independent controls: real row menu handlers and explicit account results.
test("returned auth error is recovery, not a successful empty feed", async () => {
 (supabase.auth.getUser as jest.Mock).mockResolvedValue({data:{user:null},error:new Error("auth unavailable")});
 (listFeed as jest.Mock).mockResolvedValue([]);await mount();
 expect(contents()).toContain("Couldn't load your feed");expect(contents()).not.toContain("first story");expect(computeTasteVector).not.toHaveBeenCalled();
});
test("refresh auth error retains old cards but cannot publish unowned incoming rows", async () => {
 (listFeed as jest.Mock).mockResolvedValueOnce([row("saved-row")]).mockResolvedValueOnce([row("unowned-row")]);await mount();
 (supabase.auth.getUser as jest.Mock).mockResolvedValue({data:{user:null},error:new Error("auth unavailable")});await startRefresh();
 expect(contents()).toContain("saved-row");expect(contents()).not.toContain("unowned-row");expect(contents()).toContain("Couldn't refresh your feed");
});
test("explicit null account clears old cards and does not call empty success", async () => {
 (listFeed as jest.Mock).mockResolvedValueOnce([row("private-old")]).mockResolvedValueOnce([]);await mount();
 (supabase.auth.getUser as jest.Mock).mockResolvedValue({data:{user:null},error:null});await startRefresh();
 expect(contents()).not.toContain("private-old");expect(contents()).toContain("Couldn't load your feed");expect(contents()).not.toContain("first story");
 expect(computeTasteVector).toHaveBeenCalledTimes(1);
});
test("account-key replacement rejects the previous account's pending read", async () => {
 const old=deferred(),next=deferred();(listFeed as jest.Mock).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);await mount();
 (supabase.auth.getUser as jest.Mock).mockResolvedValue({data:{user:{id:"new-account"}},error:null});await act(async()=>tree.update(<FeedTab key="new-account"/>));
 await act(async()=>next.resolve([row("new-account-row")]));await act(async()=>old.resolve([row("old-account-row")]));
 expect(contents()).toContain("new-account-row");expect(contents()).not.toContain("old-account-row");expect(computeTasteVector).toHaveBeenCalledTimes(1);
});
test("actual row block handler removes blocked-author previews without subtracting authoritative count twice", async () => {
 const pending=deferred();const other={...row("other-row"),topComments:[{id:"c1",body:"BLOCKED_PREVIEW",author:"blocked",user_id:"blocked-row"},{id:"c2",body:"SAFE_PREVIEW",author:"other",user_id:"other"}],commentCount:8};
 (listFeed as jest.Mock).mockResolvedValueOnce([row("blocked-row"),other]).mockReturnValueOnce(pending.promise);(blockUser as jest.Mock).mockResolvedValue(undefined);
 const alert=jest.spyOn(Alert,"alert").mockImplementation(()=>{});await mount();await startRefresh();
 await act(async()=>sheet().onCountChange("other-row",7));
 await act(async()=>tree.root.findAll((n:any)=>n.props.accessibilityLabel==="Post options"&&n.props.onPress)[0].props.onPress());
 await act(async()=> (alert.mock.calls.at(-1)![2] as any[]).find(x=>x.text.startsWith("Block ")).onPress());
 await act(async()=> (alert.mock.calls.at(-1)![2] as any[]).find(x=>x.text==="Block").onPress());
 expect(blockUser).toHaveBeenCalledWith("blocked-row");expect(contents()).not.toContain("BLOCKED_PREVIEW");expect(contents()).toContain("SAFE_PREVIEW");expect(contents()).toContain("7 comments");
 await act(async()=>pending.resolve([row("blocked-row"),other]));expect(contents()).not.toContain("BLOCKED_PREVIEW");expect(contents()).toContain("7 comments");alert.mockRestore();
});
test("actual row report completion survives the older refresh", async () => {
 const pending=deferred();(listFeed as jest.Mock).mockResolvedValueOnce([row("report-row")]).mockReturnValueOnce(pending.promise);(reportContent as jest.Mock).mockResolvedValue(undefined);
 const alert=jest.spyOn(Alert,"alert").mockImplementation(()=>{});await mount();await startRefresh();
 await act(async()=>tree.root.findAll((n:any)=>n.props.accessibilityLabel==="Post options"&&n.props.onPress)[0].props.onPress());
 await act(async()=> (alert.mock.calls.at(-1)![2] as any[]).find(x=>x.text==="Report post").onPress());
 await act(async()=> (alert.mock.calls.at(-1)![2] as any[]).find(x=>x.text==="Spam").onPress());
 expect(reportContent).toHaveBeenCalledWith(expect.objectContaining({targetId:"report-row"}));await act(async()=>pending.resolve([row("report-row")]));expect(contents()).not.toContain("report-row");alert.mockRestore();
});
