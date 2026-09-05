import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("../analytics", () => ({ track: jest.fn() }));
jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
}));

import { notifCountToday, bumpNotifCount, MAX_NOTIFS_PER_DAY } from "../passive-confirm";

const RATE_KEY = "palate.passive.notifRate";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("daily notification cap", () => {
  it("starts at zero", async () => {
    expect(await notifCountToday()).toBe(0);
  });

  it("counts up and reaches the cap", async () => {
    for (let i = 0; i < MAX_NOTIFS_PER_DAY; i++) await bumpNotifCount();
    expect(await notifCountToday()).toBe(MAX_NOTIFS_PER_DAY);
    // The call site gates on >= cap, so this is the state that stops prompting.
    expect(await notifCountToday()).toBeGreaterThanOrEqual(MAX_NOTIFS_PER_DAY);
  });

  it("resets when the stored day is not today", async () => {
    // Yesterday's tally must not eat into today's allowance.
    await AsyncStorage.setItem(RATE_KEY, JSON.stringify({ day: "2020-01-01", count: 99 }));
    expect(await notifCountToday()).toBe(0);
    await bumpNotifCount();
    expect(await notifCountToday()).toBe(1);
  });

  it("survives a corrupt rate record instead of throwing", async () => {
    // A crash here would take down the whole pipeline run.
    await AsyncStorage.setItem(RATE_KEY, "{not json");
    expect(await notifCountToday()).toBe(0);
  });

  it("keeps counting within the same day across separate calls", async () => {
    await bumpNotifCount();
    await bumpNotifCount();
    expect(await notifCountToday()).toBe(2);
  });
});

describe("ignored entries", () => {
  const INBOX_KEY = "palate.passive.inbox";

  function entry(id: string, ageHours: number, band = "high") {
    return {
      id, place_id: `pid-${id}`, name: id, address: "", alternates: [],
      detectedAt: Date.now() - ageHours * 3_600_000,
      dwellMin: 30, confidence: 0.9, confidenceBand: band, candidateCount: 1,
    };
  }

  it("records an ignore when an entry expires unanswered", async () => {
    // Silent expiry would bias calibration upward: a stream of bad High
    // prompts that everyone ignores would score as excellent, because only the
    // answered ones would count.
    const { track } = require("../analytics");
    (track as jest.Mock).mockClear();
    const { getInbox } = require("../passive-confirm");

    await AsyncStorage.setItem(INBOX_KEY, JSON.stringify([entry("old", 50), entry("fresh", 1)]));
    const live = await getInbox();

    expect(live.map((e: any) => e.id)).toEqual(["fresh"]);
    const ignores = (track as jest.Mock).mock.calls.filter((c) => c[0] === "visit_ignored");
    expect(ignores).toHaveLength(1);
    expect(ignores[0][1]).toMatchObject({ place_id: "pid-old", confidence_band: "high" });
  });

  it("does not emit anything when nothing expired", async () => {
    const { track } = require("../analytics");
    (track as jest.Mock).mockClear();
    const { getInbox } = require("../passive-confirm");

    await AsyncStorage.setItem(INBOX_KEY, JSON.stringify([entry("fresh", 1)]));
    await getInbox();

    expect((track as jest.Mock).mock.calls.filter((c) => c[0] === "visit_ignored")).toHaveLength(0);
  });
});

describe("digest fixtures", () => {
  it("seeds one entry per band, including an ambiguous one", async () => {
    // The digest had never rendered once: it needs a same-day capture AND
    // 8:30pm. Fixtures make the screen verifiable without either.
    const { seedDigestFixtures, getInbox } = require("../passive-confirm");
    const { buildDigest } = require("../passive-digest");

    const n = await seedDigestFixtures();
    expect(n).toBe(3);

    const d = buildDigest(await getInbox());
    expect(d.high).toHaveLength(1);
    expect(d.medium).toHaveLength(1);
    expect(d.low).toHaveLength(1);
    // The ambiguous entry renders a "which one?" picker rather than a yes/no,
    // which is a distinct path worth exercising.
    expect(d.low[0].ambiguous).toBe(true);
    expect(d.low[0].alternates.length).toBeGreaterThan(0);
    // High and medium arrive pre-checked — the two bands the notification
    // counts. The ambiguous low entry does not: it needs a place picked first.
    expect(d.high[0].preChecked).toBe(true);
    expect(d.medium[0].preChecked).toBe(true);
    expect(d.low[0].preChecked).toBe(false);
  });
});
