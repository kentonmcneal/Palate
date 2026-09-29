import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { rescheduleDigest } from "../passive-confirm";
import { track } from "../analytics";

const mockQueue = new Map<string, any>();
let mockSequence = 0;
jest.mock("../analytics", () => ({ track: jest.fn() }));
jest.mock("../observability", () => ({ captureError: jest.fn(), breadcrumb: jest.fn() }));
jest.mock("../passive-inbox-sync", () => ({ mirrorInbox: jest.fn() }));
jest.mock("../visits", () => ({ recentlyPrompted: jest.fn(), placeRefusals: jest.fn(), shouldDemote: jest.fn() }));
jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn(), cancelScheduledNotificationAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(), SchedulableTriggerInputTypes: { DATE: "date" },
}));
const INBOX = "palate.passive.inbox", ID = "palate.passive.digestNotifId";
const noop = async () => undefined;
const list = async () => [...mockQueue].map(([identifier, request]) => ({ identifier, content: request.content }));
const current = () => ({ id: "fixture", place_id: "synthetic", name: "Synthetic cafe", address: "Fixture", alternates: [], detectedAt: Date.now(), dwellMin: 10, confidenceBand: "high" });
async function arm() {
  await AsyncStorage.setItem(INBOX, JSON.stringify([current()]));
  await rescheduleDigest();
  expect(mockQueue.size).toBe(1);
  jest.clearAllMocks();
  return [...mockQueue.keys()][0];
}
function noReplacement() { expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled(); }
function visibleFailure() { expect(track).toHaveBeenCalledWith("digest_schedule_failed", expect.any(Object)); }
beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockQueue.clear(); mockSequence = 0;
  jest.useFakeTimers().setSystemTime(new Date(2026, 8, 28, 12));
  (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockReset().mockImplementation(list);
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockReset().mockImplementation(async id => { mockQueue.delete(id); });
  (Notifications.scheduleNotificationAsync as jest.Mock).mockReset().mockImplementation(async request => {
    const id = `fixture-${++mockSequence}`; mockQueue.set(id, request); return id;
  });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it("read rejection preserves the armed request and identifier, then respects confirmed-empty recovery", async () => {
  const id = await arm();
  jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("read unavailable"));
  await rescheduleDigest();
  expect(mockQueue.has(id)).toBe(true); expect(await AsyncStorage.getItem(ID)).toBe(id);
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled(); noReplacement(); visibleFailure();
  await AsyncStorage.setItem(INBOX, "[]"); await rescheduleDigest();
  expect(mockQueue.size).toBe(0); noReplacement();
});
it.each(["", " ", "null", "{}", '[{"detectedAt":"invalid"}]'])("malformed stored inbox %p is unavailable, not empty", async value => {
  const id = await arm(); await AsyncStorage.setItem(INBOX, value);
  // The official storage mock collapses empty strings to null; model the real string result explicitly.
  jest.spyOn(AsyncStorage, "getItem").mockResolvedValueOnce(value);
  await rescheduleDigest();
  expect(mockQueue.has(id)).toBe(true); expect(await AsyncStorage.getItem(ID)).toBe(id);
  expect(Notifications.getAllScheduledNotificationsAsync).not.toHaveBeenCalled(); noReplacement(); visibleFailure();
});
it("missing inbox is verified empty and disarms owned requests", async () => {
  await arm(); await AsyncStorage.removeItem(INBOX); await rescheduleDigest();
  expect(mockQueue.size).toBe(0); expect(await AsyncStorage.getItem(ID)).toBeNull(); noReplacement();
});
it("failed initial enumeration changes neither the queue nor identifier", async () => {
  const id = await arm(); (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockRejectedValueOnce(new Error("list unavailable"));
  await rescheduleDigest(); expect(mockQueue.has(id)).toBe(true); expect(await AsyncStorage.getItem(ID)).toBe(id);
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled(); noReplacement(); visibleFailure();
});
it("fulfilled no-op cancellation prevents a duplicate and later recovers", async () => {
  const id = await arm(); (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementationOnce(noop);
  await rescheduleDigest(); expect(mockQueue.has(id)).toBe(true); noReplacement(); visibleFailure();
  await rescheduleDigest(); expect(mockQueue.size).toBe(1); expect(mockQueue.has(id)).toBe(false);
});
it("verification read failure cannot authorize replacement", async () => {
  await arm(); (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockImplementationOnce(list).mockRejectedValueOnce(new Error("verification unavailable"));
  await rescheduleDigest(); expect(mockQueue.size).toBe(0); noReplacement(); visibleFailure();
  expect(JSON.parse((await AsyncStorage.getItem(INBOX))!)).toHaveLength(1);
  await rescheduleDigest(); expect(mockQueue.size).toBe(1);
});
it("partial cancellation failure preserves remaining owned request and never touches unrelated stored ID", async () => {
  const first = await arm(); mockQueue.set("orphan", mockQueue.get(first));
  const weekly = { content: { data: { type: "weekly_wrapped" } } }; mockQueue.set("weekly", weekly);
  await AsyncStorage.setItem(ID, "weekly");
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementationOnce(async id => { mockQueue.delete(id); }).mockRejectedValueOnce(new Error("cancel unavailable"));
  await rescheduleDigest(); expect(mockQueue.has(first)).toBe(false); expect(mockQueue.has("orphan")).toBe(true);
  expect(mockQueue.get("weekly")).toBe(weekly); noReplacement(); visibleFailure();
  await rescheduleDigest(); expect(mockQueue.size).toBe(2); expect(mockQueue.get("weekly")).toBe(weekly); expect(mockQueue.has("orphan")).toBe(false);
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith("weekly");
});
it("request appearing during cancellation is caught by verification", async () => {
  const id = await arm(); const request = mockQueue.get(id);
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementationOnce(async key => { mockQueue.delete(key); mockQueue.set("interloper", request); });
  await rescheduleDigest(); expect(mockQueue.has("interloper")).toBe(true); noReplacement(); visibleFailure();
});
it("serialized overlapping calls read current inbox after preceding failed cancellation", async () => {
  const id = await arm(); let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  let entered!: () => void; const started = new Promise<void>(r => { entered = r; });
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementationOnce(async () => { entered(); await gate; throw Error("cancel unavailable"); });
  const first = rescheduleDigest(); await started;
  await AsyncStorage.setItem(INBOX, "[]"); const second = rescheduleDigest(); release();
  await Promise.all([first, second]); expect(mockQueue.has(id)).toBe(false); expect(mockQueue.size).toBe(0); noReplacement();
});
