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
