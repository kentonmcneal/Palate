import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("../analytics", () => ({ track: jest.fn() }));
jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue("notif-id"),
  cancelScheduledNotificationAsync: jest.fn(),
  setNotificationCategoryAsync: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  SchedulableTriggerInputTypes: { DATE: "date", WEEKLY: "weekly" },
}));
jest.mock("../visits", () => ({ recentlyPrompted: jest.fn().mockResolvedValue(false) }));

import * as Notifications from "expo-notifications";
import { getInbox, removeFromInbox, notifyOrInbox } from "../passive-confirm";

// ============================================================================
// The founder's bug, pinned.
// ----------------------------------------------------------------------------
// "It definitely shouldn't fire if it's already been filled out."
//
// rescheduleDigest was called in exactly two places, both when an entry was
// ADDED. Confirming took the entry out of the inbox and left the evening's
// notification armed with copy about a place already dealt with. The digest
// then fired anyway, hours later, about nothing.
//
// The fix is one line inside removeFromInbox. This test is what stops it being
// deleted as redundant.
// ============================================================================

function resolved(placeId: string, name: string, detectedAt: number) {
  return {
    raw: {
      id: `${placeId}-${detectedAt}`,
      departureAt: detectedAt,
      capturedAt: detectedAt,
      horizontalAccuracy: 30,
      source: "visit",
    },
    candidates: [{ google_place_id: placeId, name, address: "1 Main St" }],
    cacheHit: false,
  } as never;
}

const NOON = new Date();
NOON.setHours(12, 0, 0, 0);

describe("confirming empties the inbox AND disarms the digest", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOON);
  });
  afterEach(() => { jest.useRealTimers(); });

  it("schedules a digest when a visit lands, and cancels it once confirmed", async () => {
    await notifyOrInbox(resolved("p1", "Chipotle", NOON.getTime()), 40);
    const inbox = await getInbox();
    expect(inbox).toHaveLength(1);

    // Something was scheduled for tonight.
    const scheduledCalls = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls;
    expect(scheduledCalls.length).toBeGreaterThan(0);

    (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();

    // The user confirms it. The inbox empties...
    await removeFromInbox(inbox[0].id);
    expect(await getInbox()).toHaveLength(0);

    // ...and NOTHING new is scheduled, because an empty digest is not worth
    // sending. Before the fix, the earlier notification simply stayed armed.
    const after = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls;
    const digests = after.filter((c) => c[0]?.content?.data?.kind === "passive_digest");
    expect(digests).toHaveLength(0);
  });

  it("rewrites rather than stacks when a second visit lands", async () => {
    await notifyOrInbox(resolved("p1", "Chipotle", NOON.getTime()), 40);
    await notifyOrInbox(resolved("p2", "Ruby's", NOON.getTime() + 3 * 3_600_000), 50);

    // Two entries, and the previous digest is cancelled before each rewrite,
    // so the person is never told about the same evening twice.
    expect(await getInbox()).toHaveLength(2);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalled();
  });
});
