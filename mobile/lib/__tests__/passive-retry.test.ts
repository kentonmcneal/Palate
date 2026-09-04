import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("../analytics", () => ({ track: jest.fn() }));
jest.mock("../flags", () => ({ isFlagEnabled: jest.fn().mockResolvedValue(true) }));
jest.mock("../../modules/palate-visit-monitor", () => ({ logDetectorNote: jest.fn() }));
jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
}));

const mockDrain = jest.fn();
jest.mock("../passive-capture", () => ({
  drainNativeVisits: (...a: unknown[]) => mockDrain(...a),
  PASSIVE_CAPTURE_FLAG: "passive_capture",
}));

// The pipeline itself is exercised elsewhere. What matters here is only whether
// a FAILING run destroys the visit, so qualifyVisit is the seam.
const mockQualify = jest.fn();
jest.mock("../passive-pipeline", () => ({
  qualifyVisit: (...a: unknown[]) => mockQualify(...a),
  resolveVenue: jest.fn(),
  recordForClustering: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../passive-confirm", () => ({ notifyOrInbox: jest.fn() }));

import { processPendingVisits, MAX_PIPELINE_ATTEMPTS } from "../passive-runner";

const raw = { id: "raw-1", simulated: false, source: "visit", horizontalAccuracy: 30 };

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

// `drainNativeVisits` EMPTIES the native queue, so a raw visit taken from it
// exists nowhere else. The old code marked an id processed even when the
// pipeline threw, which meant one transient failure destroyed a real meal with
// no trace and no way to recover it.
describe("pipeline failure does not destroy the visit", () => {
  it("retries a transient failure on the next run and succeeds", async () => {
    mockDrain.mockResolvedValueOnce([raw]);
    mockQualify.mockRejectedValueOnce(new Error("network"));

    const first = await processPendingVisits();
    expect(first.detected).toBe(1);
    expect(first.outcomes).toHaveLength(0);
    expect(first.dropped).toBe(0);

    // Native queue is empty now — the retry must come from our own storage.
    mockDrain.mockResolvedValueOnce([]);
    mockQualify.mockResolvedValueOnce({ ok: false, reason: "unqualified" });

    const second = await processPendingVisits();
    expect(second.retried).toBe(1);
    expect(second.outcomes).toHaveLength(1);
  });

  it("does not create a duplicate once it finally succeeds", async () => {
    mockDrain.mockResolvedValueOnce([raw]);
    mockQualify.mockRejectedValueOnce(new Error("network"));
    await processPendingVisits();

    mockDrain.mockResolvedValueOnce([]);
    mockQualify.mockResolvedValueOnce({ ok: false, reason: "unqualified" });
    await processPendingVisits();

    // A third run has nothing left to do — the id is processed, not re-queued.
    mockDrain.mockResolvedValueOnce([]);
    const third = await processPendingVisits();
    expect(third.detected).toBe(0);
    expect(third.retried).toBe(0);
    expect(third.outcomes).toHaveLength(0);
  });

  it("gives up after the attempt cap instead of retrying forever", async () => {
    for (let i = 0; i < MAX_PIPELINE_ATTEMPTS; i++) {
      mockDrain.mockResolvedValueOnce(i === 0 ? [raw] : []);
      mockQualify.mockRejectedValueOnce(new Error("permanent"));
      var last = await processPendingVisits();
    }
    expect(last!.dropped).toBe(1);

    // Given up on: not retried again on the next foreground.
    mockDrain.mockResolvedValueOnce([]);
    const after = await processPendingVisits();
    expect(after.retried).toBe(0);
  });

  it("reports a dropped visit rather than losing it quietly", async () => {
    const { track } = require("../analytics");
    for (let i = 0; i < MAX_PIPELINE_ATTEMPTS; i++) {
      mockDrain.mockResolvedValueOnce(i === 0 ? [raw] : []);
      mockQualify.mockRejectedValueOnce(new Error("permanent"));
      await processPendingVisits();
    }
    expect((track as jest.Mock).mock.calls.filter((c) => c[0] === "visit_dropped")).toHaveLength(1);
  });

  it("one bad visit does not take the rest of the batch down", async () => {
    mockDrain.mockResolvedValueOnce([raw, { ...raw, id: "raw-2" }]);
    mockQualify
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ ok: false, reason: "unqualified" });

    const run = await processPendingVisits();
    expect(run.outcomes).toHaveLength(1);
    expect(run.dropped).toBe(0);
  });
});
