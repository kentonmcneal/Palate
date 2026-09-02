import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  shouldReportDay7, reportDay7PermissionState, setPassiveOptIn, DAY7_MS,
} from "../passive-capture";

beforeEach(async () => { await AsyncStorage.clear(); });

describe("shouldReportDay7", () => {
  const t0 = 1_700_000_000_000;

  it("waits for the full week", () => {
    expect(shouldReportDay7(t0, t0 + DAY7_MS - 1, false)).toBe(false);
    expect(shouldReportDay7(t0, t0 + DAY7_MS, false)).toBe(true);
  });

  it("never fires twice", () => {
    expect(shouldReportDay7(t0, t0 + DAY7_MS * 3, true)).toBe(false);
  });

  it("does nothing without an opt-in timestamp", () => {
    expect(shouldReportDay7(null, t0 + DAY7_MS, false)).toBe(false);
  });
});

describe("reportDay7PermissionState", () => {
  it("stays silent before the mark", async () => {
    await setPassiveOptIn(true);
    const emit = jest.fn();
    expect(await reportDay7PermissionState(async () => true, emit)).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it("reports once after the mark, then never again", async () => {
    // Backdate the opt-in rather than waiting a week.
    await AsyncStorage.setItem("palate.passive.optInAt", String(Date.now() - DAY7_MS - 1000));
    const emit = jest.fn();

    expect(await reportDay7PermissionState(async () => false, emit)).toBe(true);
    expect(emit).toHaveBeenCalledWith(false, 7);

    expect(await reportDay7PermissionState(async () => false, emit)).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("reports the revoked case, which is the whole point of measuring at day 7", async () => {
    await AsyncStorage.setItem("palate.passive.optInAt", String(Date.now() - DAY7_MS));
    const emit = jest.fn();
    await reportDay7PermissionState(async () => false, emit);
    expect(emit.mock.calls[0][0]).toBe(false);
  });

  it("retries rather than losing the measurement if the permission read throws", async () => {
    await AsyncStorage.setItem("palate.passive.optInAt", String(Date.now() - DAY7_MS));
    const emit = jest.fn();
    await reportDay7PermissionState(async () => { throw new Error("boom"); }, emit);
    expect(emit).not.toHaveBeenCalled();
    // Not marked as reported, so a later foreground still captures it.
    expect(await reportDay7PermissionState(async () => true, emit)).toBe(true);
  });

  it("does not overwrite the original opt-in stamp on a re-opt-in", async () => {
    await setPassiveOptIn(true);
    const first = await AsyncStorage.getItem("palate.passive.optInAt");
    await setPassiveOptIn(false);
    await setPassiveOptIn(true);
    expect(await AsyncStorage.getItem("palate.passive.optInAt")).toBe(first);
  });
});
