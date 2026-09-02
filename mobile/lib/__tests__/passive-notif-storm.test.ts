import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("../analytics", () => ({ track: jest.fn() }));
jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn(),
  setNotificationCategoryAsync: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
}));
jest.mock("../visits", () => ({
  recentlyPrompted: jest.fn().mockResolvedValue(false),
}));

import * as Notifications from "expo-notifications";
import {
  notifyOrInbox,
  getInbox,
  minutesSinceLastNotif,
  bumpNotifCount,
  MIN_NOTIF_GAP_MIN,
} from "../passive-confirm";

// A tester's lock screen showed the same two restaurants five times between
// them in under ten minutes. The inbox deduped correctly; the notification
// path never asked the inbox whether it already held the entry.
function resolved(placeId: string, name: string, detectedAt: number) {
  return {
    raw: {
      id: `${placeId}-${detectedAt}`,
      departureAt: detectedAt,
      capturedAt: detectedAt,
      horizontalAccuracy: 30,
      source: "visit",
    },
    candidates: [
      { google_place_id: placeId, name, address: "1 Main St" },
    ],
    cacheHit: false,
  } as never;
}

const NOON = new Date();
NOON.setHours(12, 0, 0, 0);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(NOON);
});
afterEach(() => {
  jest.useRealTimers();
});

describe("duplicate confirm notifications", () => {
  it("notifies once for a venue, then suppresses the repeat detection", async () => {
    const t = NOON.getTime();
    const first = await notifyOrInbox(resolved("kobe", "Kobe Japanese Express", t), 22);
    const second = await notifyOrInbox(resolved("kobe", "Kobe Japanese Express", t + 60_000), 22);

    expect(first).toBe("notified");
    expect(second).toBe("suppressed-duplicate");
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(await getInbox()).toHaveLength(1);
  });

  it("holds a different venue back until the minimum gap has passed", async () => {
    const t = NOON.getTime();
    await notifyOrInbox(resolved("kobe", "Kobe Japanese Express", t), 22);
    const other = await notifyOrInbox(resolved("nashmi", "Nashmi Bakery & Sweets", t + 120_000), 15);

    // Still captured — the inbox never loses a prompt — but no second buzz.
    expect(other).toBe("inboxed-rate-limited");
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(await getInbox()).toHaveLength(2);
  });

  it("notifies again once the gap has elapsed", async () => {
    const t = NOON.getTime();
    await notifyOrInbox(resolved("kobe", "Kobe Japanese Express", t), 22);

    jest.setSystemTime(new Date(t + (MIN_NOTIF_GAP_MIN + 1) * 60_000));
    const later = await notifyOrInbox(
      resolved("nashmi", "Nashmi Bakery & Sweets", t + (MIN_NOTIF_GAP_MIN + 1) * 60_000),
      15,
    );

    expect(later).toBe("notified");
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it("attaches the Yes/No action category to the notification", async () => {
    await notifyOrInbox(resolved("kobe", "Kobe Japanese Express", NOON.getTime()), 22);
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.content.categoryIdentifier).toBe("passive_confirm");
    expect(arg.content.data.place_id).toBe("kobe");
  });
});

describe("minutesSinceLastNotif", () => {
  it("is null before anything has been sent", async () => {
    expect(await minutesSinceLastNotif()).toBeNull();
  });

  it("measures the gap from the last send", async () => {
    await bumpNotifCount();
    const mins = await minutesSinceLastNotif(Date.now() + 5 * 60_000);
    expect(mins).toBeCloseTo(5, 1);
  });
});
