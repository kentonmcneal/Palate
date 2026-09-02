import {
  confidenceScore, confidenceBand, dwellScore, accuracyScore, densityCeiling,
  HIGH_BAND_MIN, MEDIUM_BAND_MIN,
} from "../passive-confidence";
import type { Restaurant } from "../places";

function place(primary_type = "restaurant"): Restaurant {
  return { google_place_id: "x", name: "x", primary_type } as Restaurant;
}

const IDEAL = {
  dwellMin: 45, accuracyM: 20, candidateCount: 1, hour: 12,
  place: place(), visitedBefore: true,
};

describe("sub-scores", () => {
  it("saturates dwell rather than ramping linearly", () => {
    // The first minutes carry the most information: 5->20 should move the
    // score far more than 45->60.
    expect(dwellScore(20) - dwellScore(5)).toBeGreaterThan(dwellScore(60) - dwellScore(45));
    expect(dwellScore(60)).toBeCloseTo(1, 1);
    expect(dwellScore(0)).toBe(0);
  });

  it("scores accuracy best at tight fixes and bottoms out at the gate", () => {
    expect(accuracyScore(20)).toBe(1);
    expect(accuracyScore(100)).toBe(0);
    expect(accuracyScore(60)).toBeCloseTo(0.5, 1);
  });

  it("caps attainable confidence by how many venues are in range", () => {
    // Density limits what any evidence can claim, rather than being weighed
    // against it. Three or more candidates can never reach the High band.
    expect(densityCeiling(1)).toBe(1);
    expect(densityCeiling(2)).toBeGreaterThan(densityCeiling(3));
    expect(densityCeiling(3)).toBeLessThan(0.75);
  });
});

describe("confidenceScore", () => {
  it("puts an unambiguous long lunch at a known place in the High band", () => {
    const s = confidenceScore(IDEAL);
    expect(s).toBeGreaterThanOrEqual(HIGH_BAND_MIN);
    expect(confidenceBand(s)).toBe("high");
  });

  it("puts a clean 5-minute counter-service stop in Medium, not Low", () => {
    // The product requires these are CAPTURED. The spec requires they are not
    // pre-checked. Medium is exactly that: shown, unchecked.
    const s = confidenceScore({
      ...IDEAL, dwellMin: 5, accuracyM: 30, visitedBefore: false,
      place: place("fast_food_restaurant"),
    });
    expect(confidenceBand(s)).toBe("medium");
  });

  it("keeps a dense-retail stop out of the High band however long the dwell", () => {
    // Four doors within range: no amount of sitting still tells us which one.
    const s = confidenceScore({ ...IDEAL, dwellMin: 90, candidateCount: 4 });
    expect(s).toBeLessThan(HIGH_BAND_MIN);
  });

  it("sends a short, imprecise, ambiguous, off-hours stop to Low", () => {
    const s = confidenceScore({
      dwellMin: 8, accuracyM: 95, candidateCount: 6, hour: 15,
      place: place("clothing_store"), visitedBefore: false,
    });
    expect(confidenceBand(s)).toBe("low");
  });

  it("lets a closed venue veto everything else", () => {
    const open = confidenceScore(IDEAL);
    const closed = confidenceScore({ ...IDEAL, venueOpen: false });
    expect(open).toBeGreaterThanOrEqual(HIGH_BAND_MIN);
    expect(confidenceBand(closed)).toBe("low");
  });

  it("does not penalise unknown opening hours", () => {
    // Hours are not stored yet; absence of data must not look like bad news.
    expect(confidenceScore({ ...IDEAL, venueOpen: undefined })).toBe(confidenceScore(IDEAL));
    expect(confidenceScore({ ...IDEAL, venueOpen: null })).toBe(confidenceScore(IDEAL));
  });

  it("rewards a repeat visit over a first visit, all else equal", () => {
    expect(confidenceScore(IDEAL)).toBeGreaterThan(
      confidenceScore({ ...IDEAL, visitedBefore: false }),
    );
  });

  it("always returns a value inside 0-1", () => {
    const extremes = [
      { ...IDEAL, dwellMin: 100000, accuracyM: -5, candidateCount: 0 },
      { ...IDEAL, dwellMin: 0, accuracyM: 99999, candidateCount: 999, venueOpen: false },
    ];
    for (const e of extremes) {
      const s = confidenceScore(e);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

describe("confidenceBand", () => {
  it("uses inclusive lower bounds at each threshold", () => {
    expect(confidenceBand(HIGH_BAND_MIN)).toBe("high");
    expect(confidenceBand(HIGH_BAND_MIN - 0.01)).toBe("medium");
    expect(confidenceBand(MEDIUM_BAND_MIN)).toBe("medium");
    expect(confidenceBand(MEDIUM_BAND_MIN - 0.01)).toBe("low");
  });
});
