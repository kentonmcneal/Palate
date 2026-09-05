import AsyncStorage from "@react-native-async-storage/async-storage";

const mockHasAlways = jest.fn();
jest.mock("expo-location", () => ({
  getBackgroundPermissionsAsync: () => mockHasAlways(),
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
}));
jest.mock("../analytics", () => ({ track: jest.fn() }));
jest.mock("../../modules/palate-visit-monitor", () => ({
  hasAlwaysAuthorization: () => mockHasAlways().then((r: any) => r?.status === "granted"),
}));

import { needsAlwaysPrompt, dismissAlwaysPrompt } from "../passive-permissions";

beforeEach(async () => {
  await AsyncStorage.clear();
  mockHasAlways.mockReset();
});

// checkPermissionDowngrade only fires on granted -> not-granted. Somebody who
// never granted Always — because onboarding told them to pick "While Using the
// App" — was told nothing at all: opted in, toggle reading ON, no visits, no
// explanation anywhere.
describe("needsAlwaysPrompt", () => {
  it("asks when Always was never granted", async () => {
    mockHasAlways.mockResolvedValue({ status: "denied" });
    expect(await needsAlwaysPrompt()).toBe(true);
  });

  it("stays quiet once Always is granted", async () => {
    mockHasAlways.mockResolvedValue({ status: "granted" });
    expect(await needsAlwaysPrompt()).toBe(false);
  });

  it("holds off for a week after being dismissed", async () => {
    mockHasAlways.mockResolvedValue({ status: "denied" });
    await dismissAlwaysPrompt();
    expect(await needsAlwaysPrompt()).toBe(false);
  });

  it("comes back after the week is up", async () => {
    mockHasAlways.mockResolvedValue({ status: "denied" });
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await AsyncStorage.setItem("palate.passive.alwaysNagDismissedAt", String(eightDaysAgo));
    expect(await needsAlwaysPrompt()).toBe(true);
  });

  it("does not go silent when storage fails", async () => {
    // A storage error must not swallow a real problem.
    mockHasAlways.mockResolvedValue({ status: "denied" });
    const spy = jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("nope"));
    expect(await needsAlwaysPrompt()).toBe(true);
    spy.mockRestore();
  });
});
