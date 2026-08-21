import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  isPassiveOptedIn,
  setPassiveOptIn,
  optOutOfPassiveCapture,
  resumePassiveCaptureIfOptedIn,
} from "../passive-capture";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("passive capture opt-in", () => {
  it("defaults to opted out on a fresh install", async () => {
    expect(await isPassiveOptedIn()).toBe(false);
  });

  it("persists an opt-in and an opt-out", async () => {
    await setPassiveOptIn(true);
    expect(await isPassiveOptedIn()).toBe(true);
    await setPassiveOptIn(false);
    expect(await isPassiveOptedIn()).toBe(false);
  });

  it("opting out clears the preference so a later resume is a no-op", async () => {
    await setPassiveOptIn(true);
    await optOutOfPassiveCapture();
    expect(await isPassiveOptedIn()).toBe(false);
    // The gate that matters: a granted OS permission must never restart
    // monitoring on its own after the user turned the feature off.
    expect(await resumePassiveCaptureIfOptedIn()).toEqual({
      started: false,
      reason: "not-opted-in",
    });
  });

  it("resume short-circuits before touching the native layer when opted out", async () => {
    expect(await resumePassiveCaptureIfOptedIn()).toEqual({
      started: false,
      reason: "not-opted-in",
    });
  });
});
