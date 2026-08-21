import AsyncStorage from "@react-native-async-storage/async-storage";

// The native module stands in for CoreLocation: it reports the RAW
// CLAuthorizationStatus, which is the only thing that reveals a provisional
// Always grant.
let mockNativeAuth = "notDetermined";
jest.mock("../../modules/palate-visit-monitor", () => ({
  isVisitMonitorAvailable: true,
  PalateVisitMonitor: {
    authorizationStatus: () => mockNativeAuth,
    startMonitoring: jest.fn(),
    stopMonitoring: jest.fn(),
    getPendingVisits: () => [],
    clearVisits: jest.fn(),
  },
}));

// expo-location is the unreliable narrator here — see
// EXBackgroundLocationPermissionRequester.m: with no dialog to observe it
// times out and reports denied.
const mockRequestBackground = jest.fn();
jest.mock("expo-location", () => ({
  getForegroundPermissionsAsync: async () => ({ status: "granted" }),
  getBackgroundPermissionsAsync: async () => ({ status: "denied" }),
  requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
  requestBackgroundPermissionsAsync: () => mockRequestBackground(),
}));

jest.mock("../analytics", () => ({ track: jest.fn() }));

import { requestAlways, hasAlways, checkPermissionDowngrade } from "../passive-permissions";

beforeEach(async () => {
  await AsyncStorage.clear();
  mockNativeAuth = "notDetermined";
  mockRequestBackground.mockReset();
});

describe("provisional Always", () => {
  it("reports Always from the native status even when Expo says denied", async () => {
    // The provisional case: iOS granted silently, no dialog appeared, so Expo's
    // 1.5s timeout resolved as denied. CoreLocation knows better.
    mockRequestBackground.mockResolvedValue({ status: "denied", canAskAgain: true });
    mockNativeAuth = "always";

    await expect(requestAlways()).resolves.toBe("granted");
  });

  it("still honors a real grant reported by Expo", async () => {
    mockRequestBackground.mockResolvedValue({ status: "granted", canAskAgain: false });
    mockNativeAuth = "always";

    await expect(requestAlways()).resolves.toBe("granted");
  });

  it("reports deferred when neither Expo nor CoreLocation grants", async () => {
    mockRequestBackground.mockResolvedValue({ status: "denied", canAskAgain: true });
    mockNativeAuth = "whenInUse";

    await expect(requestAlways()).resolves.toBe("deferred");
  }, 10_000);

  it("survives an Expo request that throws, trusting the native read", async () => {
    mockRequestBackground.mockRejectedValue(new Error("native rejection"));
    mockNativeAuth = "always";

    await expect(requestAlways()).resolves.toBe("granted");
  });

  it("hasAlways prefers the native status over Expo's stale denied", async () => {
    mockNativeAuth = "always";
    expect(await hasAlways()).toBe(true);
    mockNativeAuth = "whenInUse";
    expect(await hasAlways()).toBe(false);
  });
});

describe("downgrade detection", () => {
  it("fires once when iOS drops Always back to When-In-Use", async () => {
    // This is where the provisional flow usually ends: the user answers the
    // system's retroactive prompt with "Keep Only While Using."
    mockNativeAuth = "always";
    expect(await checkPermissionDowngrade()).toBe(false); // first read, baseline

    mockNativeAuth = "whenInUse";
    expect(await checkPermissionDowngrade()).toBe(true); // the downgrade
    expect(await checkPermissionDowngrade()).toBe(false); // not again
  });
});
