import { buildSlate, shouldRecordSlate, SLATE_DEPTH } from "../slate";

// ============================================================================
// A slate is the only record of what the ranker DID NOT show. If it silently
// records winners only, or drops the losers first, it is worse than nothing:
// it looks like counterfactual data and is not.
// ============================================================================

const c = (id: string, final: number, match = final) =>
  ({ google_place_id: id, finalScore: final, matchScore: match });

describe("buildSlate", () => {
  it("keeps the candidates that were ranked and NOT shown", () => {
    const ranked = [c("a", 90), c("b", 80), c("c", 70)];
    const rows = buildSlate(ranked, new Set(["a"]));
    expect(rows.map((r) => r.place)).toEqual(["a", "b", "c"]);
    expect(rows.map((r) => r.shown)).toEqual([true, false, false]);
  });

  it("records rank as the position in the full ranking, not in the slate", () => {
    const ranked = [c("a", 90), c("b", 80), c("c", 70)];
    expect(buildSlate(ranked, new Set()).map((r) => r.rank)).toEqual([0, 1, 2]);
  });

  it("truncates from the bottom, so the near-misses survive and the tail goes", () => {
    const ranked = Array.from({ length: 60 }, (_, i) => c(`p${i}`, 100 - i));
    const rows = buildSlate(ranked, new Set());
    expect(rows).toHaveLength(SLATE_DEPTH);
    expect(rows[0].place).toBe("p0");
    expect(rows[rows.length - 1].place).toBe(`p${SLATE_DEPTH - 1}`);
  });

  it("de-duplicates, because a union pool can carry the same place twice", () => {
    const rows = buildSlate([c("a", 90), c("a", 88), c("b", 80)], new Set());
    expect(rows.map((r) => r.place)).toEqual(["a", "b"]);
  });

  it("stores null rather than NaN when a score is missing", () => {
    const rows = buildSlate([{ google_place_id: "a" }], new Set());
    expect(rows[0].final).toBeNull();
    expect(rows[0].match).toBeNull();
  });

  it("skips rows with no place id instead of writing an unjoinable candidate", () => {
    const rows = buildSlate([{ google_place_id: "" } as any, c("b", 80)], new Set());
    expect(rows.map((r) => r.place)).toEqual(["b"]);
  });
});

describe("shouldRecordSlate", () => {
  it("records everything at the current rate of 1", () => {
    expect(shouldRecordSlate(0.99)).toBe(true);
    expect(shouldRecordSlate(0)).toBe(true);
  });

  it("samples when the rate is lowered, which is the point of it being a constant", () => {
    expect(shouldRecordSlate(0.05, 0.1)).toBe(true);
    expect(shouldRecordSlate(0.5, 0.1)).toBe(false);
  });

  it("records nothing at zero rather than dividing by it", () => {
    expect(shouldRecordSlate(0, 0)).toBe(false);
  });
});
