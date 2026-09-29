import AsyncStorage from "@react-native-async-storage/async-storage";
import { isFlagEnabled, readFlag } from "../flags";
import { drainNativeVisits } from "../passive-capture";
import { qualifyVisit, recordForClustering, resolveVenue } from "../passive-pipeline";
import { notifyOrInbox } from "../passive-confirm";
import { processPendingVisits, CONFIRM_FLAG } from "../passive-runner";

jest.mock("../analytics", () => ({ track: jest.fn() }));
jest.mock("../observability", () => ({ breadcrumb: jest.fn() }));
jest.mock("../../modules/palate-visit-monitor", () => ({ logDetectorNote: jest.fn() }));
jest.mock("../flags", () => ({ isFlagEnabled: jest.fn(), readFlag: jest.fn() }));
jest.mock("../passive-capture", () => ({ drainNativeVisits: jest.fn(), PASSIVE_CAPTURE_FLAG: "passive_capture_detection" }));
jest.mock("../passive-pipeline", () => ({ qualifyVisit: jest.fn(), recordForClustering: jest.fn(), resolveVenue: jest.fn() }));
jest.mock("../passive-confirm", () => ({ notifyOrInbox: jest.fn() }));

const raw = { id: "admission-fixture", simulated: true, source: "visit", horizontalAccuracy: 20 };
const stored = async (key: string) => JSON.parse((await AsyncStorage.getItem(key)) ?? "[]");
const processed = () => stored("palate.passive.processedIds");
const retries = () => stored("palate.passive.retryQueue");
function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(async () => {
  jest.clearAllMocks();
  for (const seam of [isFlagEnabled, readFlag, drainNativeVisits, qualifyVisit, recordForClustering, resolveVenue, notifyOrInbox]) {
    (seam as jest.Mock).mockReset();
  }
  await AsyncStorage.clear();
  (isFlagEnabled as jest.Mock).mockResolvedValue(true);
  (readFlag as jest.Mock).mockResolvedValue(true);
  (drainNativeVisits as jest.Mock).mockResolvedValue([]);
  (qualifyVisit as jest.Mock).mockResolvedValue({ ok: true, dwellMin: 7 });
  (recordForClustering as jest.Mock).mockResolvedValue(undefined);
  (resolveVenue as jest.Mock).mockResolvedValue({ raw, candidates: [{ name: "Synthetic cafe" }] });
  (notifyOrInbox as jest.Mock).mockResolvedValue("inboxed-digest");
});

it("retains unknown confirmation across repeated runs without consuming attempts or calling delivery", async () => {
  (readFlag as jest.Mock).mockImplementation(async key => key === CONFIRM_FLAG ? null : true);
  (drainNativeVisits as jest.Mock).mockResolvedValueOnce([raw]);
  for (let i = 0; i < 5; i++) {
    const result = await processPendingVisits();
    expect(result.ran).toBe(true);
    expect(result.outcomes).toEqual([]);
    expect(result.dropped).toBe(0);
  }
  expect(await retries()).toEqual([expect.objectContaining({ raw, attempts: 0 })]);
  expect(await processed()).toEqual([]);
  expect(qualifyVisit).not.toHaveBeenCalled();
  expect(recordForClustering).not.toHaveBeenCalled();
  expect(resolveVenue).not.toHaveBeenCalled();
  expect(notifyOrInbox).not.toHaveBeenCalled();
  (readFlag as jest.Mock).mockResolvedValue(true);
  expect((await processPendingVisits()).retried).toBe(1);
  expect(notifyOrInbox).toHaveBeenCalledTimes(1);
  expect(await retries()).toEqual([]);
  expect(await processed()).toContain(raw.id);
  await processPendingVisits();
  expect(notifyOrInbox).toHaveBeenCalledTimes(1);
});

it("keeps explicit confirmation false terminal without delivery", async () => {
  (readFlag as jest.Mock).mockImplementation(async key => key !== CONFIRM_FLAG);
  (drainNativeVisits as jest.Mock).mockResolvedValueOnce([raw]);
  expect((await processPendingVisits()).outcomes[0].stage).toBe("resolved");
  expect(await processed()).toContain(raw.id);
  expect(await retries()).toEqual([]);
  expect(notifyOrInbox).not.toHaveBeenCalled();
});

it("admits one runner while detection lookup is suspended", async () => {
  const gate = deferred();
  (isFlagEnabled as jest.Mock).mockReturnValue(gate.promise);
  (drainNativeVisits as jest.Mock).mockResolvedValue([raw]);
  const first = processPendingVisits();
  const others = Array.from({ length: 8 }, () => processPendingVisits());
  gate.resolve(true);
  const summaries = await Promise.all([first, ...others]);
  expect(isFlagEnabled).toHaveBeenCalledTimes(1);
  expect(summaries.filter(s => s.ran)).toHaveLength(1);
  expect(drainNativeVisits).toHaveBeenCalledTimes(1);
  expect(recordForClustering).toHaveBeenCalledTimes(1);
  expect(resolveVenue).toHaveBeenCalledTimes(1);
  expect(notifyOrInbox).toHaveBeenCalledTimes(1);
});

it("releases admission after detection returns false", async () => {
  (isFlagEnabled as jest.Mock).mockResolvedValueOnce(false);
  expect((await processPendingVisits()).ran).toBe(false);
  expect(drainNativeVisits).not.toHaveBeenCalled();
  expect((await processPendingVisits()).ran).toBe(true);
  expect(drainNativeVisits).toHaveBeenCalledTimes(1);
});

it("releases admission if detection lookup rejects", async () => {
  // Fault injection tests finally even if the normally fail-closed flag helper throws.
  (isFlagEnabled as jest.Mock).mockRejectedValueOnce(new Error("synthetic detection failure"));
  await expect(processPendingVisits()).rejects.toThrow("synthetic detection failure");
  expect(drainNativeVisits).not.toHaveBeenCalled();
  expect((await processPendingVisits()).ran).toBe(true);
});

it("releases admission after a rejected handoff", async () => {
  (drainNativeVisits as jest.Mock).mockRejectedValueOnce(new Error("synthetic handoff failure"));
  await expect(processPendingVisits()).rejects.toThrow("synthetic handoff failure");
  (drainNativeVisits as jest.Mock).mockResolvedValueOnce([raw]);
  expect((await processPendingVisits()).ran).toBe(true);
  expect(notifyOrInbox).toHaveBeenCalledTimes(1);
});
