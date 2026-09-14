import { confirmDigest, type ConfirmableEntry, type ConfirmDeps } from "../digest-confirm";

function entry(id: string): ConfirmableEntry {
  return { id, name: `Place ${id}`, place_id: `pid-${id}`, detectedAt: Date.now(), band: "high" };
}

function deps(over: Partial<ConfirmDeps> = {}): ConfirmDeps & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    saveVisit: jest.fn().mockResolvedValue({ id: "v1" }),
    removeFromInbox: jest.fn(async (id: string) => { removed.push(id); }),
    recordPromptDecision: jest.fn().mockResolvedValue(undefined),
    track: jest.fn(),
    ...over,
  } as ConfirmDeps & { removed: string[] };
}

// The digest is the one moment the user actively hands us data. Dropping an
// entry there — which is what happened when removeFromInbox ran outside the try
// around saveVisit — means they answered the question and got nothing for it,
// with no visit written and nothing left to retry.
describe("confirmDigest", () => {
  it("keeps an entry in the inbox when its save fails", async () => {
    const d = deps({ saveVisit: jest.fn().mockRejectedValue(new Error("offline")) });
    const res = await confirmDigest([entry("a")], [], {}, d);

    expect(res.savedIds).toEqual([]);
    expect(res.failed).toEqual([{ id: "a", name: "Place a" }]);
    expect(d.removed).not.toContain("a");
  });

  it("removes an entry once its save succeeds", async () => {
    const d = deps();
    const res = await confirmDigest([entry("a")], [], {}, d);

    expect(res.savedIds).toEqual(["v1"]);
    expect(res.failed).toEqual([]);
    expect(d.removed).toContain("a");
  });

  it("saves the good ones when one in the middle fails", async () => {
    const saveVisit = jest.fn()
      .mockResolvedValueOnce({ id: "v1" })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ id: "v3" });
    const d = deps({ saveVisit });

    const res = await confirmDigest([entry("a"), entry("b"), entry("c")], [], {}, d);

    expect(res.savedIds).toEqual(["v1", "v3"]);
    expect(res.failed.map((f) => f.id)).toEqual(["b"]);
    expect(d.removed).toEqual(["a", "c"]);
  });

  it("does not resurrect a saved entry when telemetry fails", async () => {
    // A failed analytics call must not leave the entry behind — the retry
    // would write the same visit a second time.
    const d = deps({
      recordPromptDecision: jest.fn().mockRejectedValue(new Error("nope")),
      track: jest.fn(() => { throw new Error("nope"); }),
    });
    const res = await confirmDigest([entry("a")], [], {}, d).catch((e) => e);

    expect(d.removed).toContain("a");
    expect((res as { savedIds: string[] }).savedIds).toEqual(["v1"]);
  });

  it("uses the corrected place when the user picked a different one", async () => {
    const saveVisit = jest.fn().mockResolvedValue({ id: "v1" });
    const d = deps({ saveVisit });
    await confirmDigest([entry("a")], [], { a: { google_place_id: "corrected" } }, d);

    // The VISIT goes to the corrected place — that is where they ate.
    expect(saveVisit).toHaveBeenCalledWith(expect.objectContaining({ googlePlaceId: "corrected" }));
    // The wrong_place DECISION goes against the place we guessed, "pid-a".
    //
    // This asserted "corrected" and was backwards: it told the learning system
    // that the restaurant the person had just confirmed eating at was a bad
    // guess, demoting the right answer, while the venue we actually got wrong
    // was never marked and stayed exactly as likely to be guessed tomorrow.
    // In the one code path whose whole purpose is learning from a correction.
    expect(d.recordPromptDecision).toHaveBeenCalledWith("pid-a", "wrong_place", null);
  });

  it("records the decision against the STOP POSITION, not just the brand", () => {
    // Every prompt_decision ever written had a null lat and lng — 110 rows,
    // none with a position — because ConfirmableEntry did not declare the
    // coordinates and confirmDigest never passed them on. The realtime confirm
    // screens DO pass a position, but REALTIME_PROMPTS_ENABLED is false, so
    // the only path that runs in production was the only one that dropped it.
    //
    // Without a position, a refusal is evidence about a BRAND rather than
    // about a brand at a place: "not the Panda Express" instead of "not the
    // Panda Express from inside this Walmart car park".
    return (async () => {
      const d = deps();
      const withStop = { ...entry("a"), stopLat: 35.05116, stopLng: -89.81519 };
      await confirmDigest([], [withStop as never], {}, d);
      expect(d.recordPromptDecision).toHaveBeenCalledWith(
        "pid-a", "dismissed", { lat: 35.05116, lng: -89.81519 },
      );
    })();
  });

  it("clears skipped entries without writing anything", async () => {
    const d = deps();
    const res = await confirmDigest([], [entry("s")], {}, d);

    expect(d.saveVisit).not.toHaveBeenCalled();
    expect(d.removed).toContain("s");
    expect(res.failed).toEqual([]);
  });
});

// ============================================================================
// The reaction, collected on the row at confirm time.
// ----------------------------------------------------------------------------
// Two of fifty-five visits carried a rating before this shipped, because the
// only way to give one was to open the visit afterwards. The rating is the
// input to half the roadmap, so it moved to the one moment somebody is
// already thinking about the meal. It must stay optional, and it must never
// be able to cost the visit it is about.
// ============================================================================
describe("ratings at confirm time", () => {
  const entry = (id: string) => ({ id, name: `P${id}`, place_id: `g${id}`, detectedAt: 1 });

  function deps(over: Partial<Record<string, any>> = {}) {
    const rated: [string, string][] = [];
    const tracked: string[] = [];
    return {
      rated, tracked,
      d: {
        saveVisit: async ({ googlePlaceId }: any) => ({ id: `v-${googlePlaceId}` }),
        removeFromInbox: async () => {},
        recordPromptDecision: async () => {},
        track: (n: string) => { tracked.push(n); },
        rateVisit: async (visitId: string, r: string) => { rated.push([visitId, r]); },
        ...over,
      } as any,
    };
  }

  it("writes the rating against the visit that was just saved", async () => {
    const { rated, tracked, d } = deps();
    const res = await confirmDigest([entry("1")], [], {}, d, { "1": "loved" });
    expect(rated).toEqual([["v-g1", "loved"]]);
    expect(res.ratedCount).toBe(1);
    expect(tracked).toContain("visit_rated");
  });

  it("saves the visit fine when nobody rated anything", async () => {
    const { rated, d } = deps();
    const res = await confirmDigest([entry("1"), entry("2")], [], {}, d);
    expect(rated).toEqual([]);
    expect(res.savedIds).toEqual(["v-g1", "v-g2"]);
    expect(res.ratedCount).toBe(0);
  });

  it("rates only the rows that were rated", async () => {
    const { rated, d } = deps();
    await confirmDigest([entry("1"), entry("2"), entry("3")], [], {}, d,
      { "1": "not_for_me", "3": "ok" });
    expect(rated).toEqual([["v-g1", "not_for_me"], ["v-g3", "ok"]]);
  });

  it("keeps the visit when the rating fails to save", async () => {
    const { d } = deps({ rateVisit: async () => { throw new Error("offline"); } });
    const res = await confirmDigest([entry("1")], [], {}, d, { "1": "loved" });
    expect(res.savedIds).toEqual(["v-g1"]);
    expect(res.ratedCount).toBe(0);
    expect(res.failed).toEqual([]);
  });

  it("rates the place the person corrected to, not the one we guessed", async () => {
    const { rated, d } = deps();
    await confirmDigest([entry("1")], [], { "1": { google_place_id: "gRIGHT" } }, d,
      { "1": "loved" });
    expect(rated).toEqual([["v-gRIGHT", "loved"]]);
  });
});

describe("a refusal is as analysable as a capture", () => {
  // All 48 refusals on record are featureless. confirm_yes carried dwell_min
  // and candidate_count; confirm_no carried neither, and neither carried
  // accuracy_m. Calibration is a comparison between the guesses people
  // accepted and the ones they rejected, and half of it was never written
  // down — which is why the only honest answer to "what does a wrong guess
  // look like" is currently "we do not know".
  const FIELDS = [
    "place_id", "surface", "confidence", "confidence_band",
    "dwell_min", "candidate_count", "accuracy_m", "has_position",
  ];

  const rich = (id: string) => ({
    ...entry(id),
    dwellMin: 25,
    candidateCount: 3,
    accuracyM: 34,
    stopLat: 35.05116,
    stopLng: -89.81519,
  });

  it("sends the same fields on confirm_yes and confirm_no", async () => {
    const yes = deps();
    await confirmDigest([rich("a") as never], [], {}, yes);
    const no = deps();
    await confirmDigest([], [rich("b") as never], {}, no);

    const call = (d: ReturnType<typeof deps>, name: string) =>
      (d.track as jest.Mock).mock.calls.find((c) => c[0] === name)?.[1] ?? {};

    const yesProps = call(yes, "confirm_yes");
    const noProps = call(no, "confirm_no");

    for (const f of FIELDS) {
      expect(Object.keys(yesProps)).toContain(f);
      expect(Object.keys(noProps)).toContain(f);
    }
    // Same shape, so the two cannot drift apart again.
    expect(Object.keys(noProps).sort()).toEqual(Object.keys(yesProps).sort());
  });

  it("carries the detection facts rather than nulls when the entry has them", async () => {
    const d = deps();
    await confirmDigest([], [rich("c") as never], {}, d);
    const props = (d.track as jest.Mock).mock.calls.find((c) => c[0] === "confirm_no")![1];
    expect(props.dwell_min).toBe(25);
    expect(props.candidate_count).toBe(3);
    expect(props.accuracy_m).toBe(34);
    expect(props.has_position).toBe(true);
  });

  it("reports has_position false when the stop coordinates are missing", async () => {
    const d = deps();
    await confirmDigest([], [entry("d") as never], {}, d);
    const props = (d.track as jest.Mock).mock.calls.find((c) => c[0] === "confirm_no")![1];
    expect(props.has_position).toBe(false);
  });
});
