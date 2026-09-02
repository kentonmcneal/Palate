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

// These tests were written after a tester's lock screen showed Kobe twice and
// Nashmi three times in nine minutes. Real-time prompts are now off by default
// (REALTIME_PROMPTS_ENABLED=false) and confirmation happens in the nightly
// digest, so the storm cannot recur by construction. The deduplication they
// protect still matters though: a repeat detection must collapse into ONE inbox
// entry, or the digest lists the same meal three times.
describe("duplicate capture handling", () => {
  it("notifies once for a venue, then suppresses the repeat detection", async () => {
    const t = NOON.getTime();
    const first = await notifyOrInbox(resolved("kobe", "Kobe Japanese Express", t), 22);
    const second = await notifyOrInbox(resolved("kobe", "Kobe Japanese Express", t + 60_000), 22);

    expect(first).toBe("inboxed-digest");
    expect(second).toBe("suppressed-duplicate");
    // One entry, so the digest lists this meal once.
    expect(await getInbox()).toHaveLength(1);
  });

  it("captures a second venue rather than holding it back", async () => {
    const t = NOON.getTime();
    await notifyOrInbox(resolved("kobe", "Kobe Japanese Express", t), 22);
    const other = await notifyOrInbox(resolved("nashmi", "Nashmi Bakery & Sweets", t + 120_000), 15);

    // Two distinct venues, two entries, no per-visit interruption for either.
    expect(other).toBe("inboxed-digest");
    expect(await getInbox()).toHaveLength(2);
  });

  it("sends no per-visit notification at all, whatever the gap", async () => {
    // The storm is impossible now: nothing schedules a per-visit prompt. The
    // only notification of the day is the digest, scheduled separately.
    const t = NOON.getTime();
    await notifyOrInbox(resolved("kobe", "Kobe Japanese Express", t), 22);

    jest.setSystemTime(new Date(t + (MIN_NOTIF_GAP_MIN + 1) * 60_000));
    const later = await notifyOrInbox(
      resolved("nashmi", "Nashmi Bakery & Sweets", t + (MIN_NOTIF_GAP_MIN + 1) * 60_000),
      15,
    );

    expect(later).toBe("inboxed-digest");
    const perVisit = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls
      .filter((c) => c[0]?.content?.categoryIdentifier === "passive_confirm");
    expect(perVisit).toHaveLength(0);
  });

  it("still lands both meals in the inbox for the digest to show", async () => {
    const t = NOON.getTime();
    await notifyOrInbox(resolved("kobe", "Kobe Japanese Express", t), 22);
    await notifyOrInbox(resolved("nashmi", "Nashmi Bakery & Sweets", t + 120_000), 15);
    const inbox = await getInbox();
    expect(inbox.map((e: any) => e.place_id).sort()).toEqual(["kobe", "nashmi"]);
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
