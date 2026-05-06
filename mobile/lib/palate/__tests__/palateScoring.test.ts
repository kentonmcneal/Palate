// ============================================================================
// palateScoring.test.ts — unit tests for the Palate identity system.
// ----------------------------------------------------------------------------
// Tests cover the spec's required cases:
//   1. noveltyScore math
//   2. premiumScore math
//   3. classification (4 quadrants + Learning state)
//   4. low-data + missing-data graceful handling
//   5. stability (small input changes don't flip identity, smoothing works)
//
// Run with: npx jest lib/palate/__tests__/palateScoring.test.ts
// (Jest is the default for Expo projects; if not installed, install with
//  `npx expo install jest jest-expo @types/jest`.)
// ============================================================================

import {
  computeNoveltyScore,
  computePremiumScore,
  classify,
  classifySecondary,
  applySmoothing,
  getUserPalateProfile,
} from "../palateScoring";
import type { UserWeeklyData } from "../palateTypes";

// Helper: build a UserWeeklyData with sensible defaults
function makeData(overrides: Partial<UserWeeklyData> = {}): UserWeeklyData {
  return {
    totalVisits: 8,
    newPlaceRate: 0.5,
    repeatRate: 0.5,
    cuisineDiversity: 0.5,
    neighborhoodDiversity: 0.5,
    normalizedPriceLevel: 0.5,
    independentRestaurantRate: 0.5,
    reservationOrOccasionSignal: 0.5,
    elevatedCategorySignal: 0.5,
    neighborhoodCount: 3,
    timeOfDayDistribution: {
      breakfast: 0.1, brunch: 0.1, lunch: 0.3, dinner: 0.4, lateNight: 0.1,
    },
    socialDiningSignals: {
      groupDinner: 0.2, dateNight: 0.2, casualSolo: 0.4,
    },
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// 1. noveltyScore math
// ----------------------------------------------------------------------------
describe("computeNoveltyScore", () => {
  it("matches spec formula exactly", () => {
    const d = makeData({
      newPlaceRate: 1, cuisineDiversity: 1, neighborhoodDiversity: 1, repeatRate: 0,
    });
    // 0.35*1 + 0.25*1 + 0.20*1 + 0.20*(1-0) = 1.00
    expect(computeNoveltyScore(d)).toBeCloseTo(1.0, 3);
  });

  it("returns 0 when all inputs are minimal", () => {
    const d = makeData({
      newPlaceRate: 0, cuisineDiversity: 0, neighborhoodDiversity: 0, repeatRate: 1,
    });
    // 0.35*0 + 0.25*0 + 0.20*0 + 0.20*(1-1) = 0
    expect(computeNoveltyScore(d)).toBeCloseTo(0, 3);
  });

  it("clamps results to [0, 1]", () => {
    const d = makeData({ newPlaceRate: 5, cuisineDiversity: 5, neighborhoodDiversity: 5, repeatRate: -2 });
    const score = computeNoveltyScore(d);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ----------------------------------------------------------------------------
// 2. premiumScore math
// ----------------------------------------------------------------------------
describe("computePremiumScore", () => {
  it("matches spec formula exactly", () => {
    const d = makeData({
      normalizedPriceLevel: 1, independentRestaurantRate: 1,
      reservationOrOccasionSignal: 1, elevatedCategorySignal: 1,
    });
    // 0.45 + 0.20 + 0.20 + 0.15 = 1.00
    expect(computePremiumScore(d)).toBeCloseTo(1.0, 3);
  });

  it("respects price-level weight (0.45)", () => {
    const onlyPrice = makeData({
      normalizedPriceLevel: 1,
      independentRestaurantRate: 0, reservationOrOccasionSignal: 0, elevatedCategorySignal: 0,
    });
    expect(computePremiumScore(onlyPrice)).toBeCloseTo(0.45, 3);
  });

  it("does NOT let price alone push above mid-tier without other signals", () => {
    // Premium requires multi-signal corroboration — price=1 alone = 0.45, well under threshold 0.55
    const onlyPrice = makeData({
      normalizedPriceLevel: 1,
      independentRestaurantRate: 0, reservationOrOccasionSignal: 0, elevatedCategorySignal: 0,
    });
    expect(computePremiumScore(onlyPrice)).toBeLessThan(0.55);
  });
});

// ----------------------------------------------------------------------------
// 3. Classification — all four quadrants + boundaries
// ----------------------------------------------------------------------------
describe("classify", () => {
  it("returns Curator for high novelty + high premium", () => {
    expect(classify(0.7, 0.7)).toBe("Curator");
  });
  it("returns Forager for high novelty + low premium", () => {
    expect(classify(0.7, 0.3)).toBe("Forager");
  });
  it("returns Steward for low novelty + high premium", () => {
    expect(classify(0.3, 0.7)).toBe("Steward");
  });
  it("returns Anchor for low novelty + low premium", () => {
    expect(classify(0.3, 0.3)).toBe("Anchor");
  });
  it("threshold edge: 0.55 inclusive on novelty axis", () => {
    expect(classify(0.55, 0.6)).toBe("Curator");
    expect(classify(0.549, 0.6)).toBe("Steward");
  });
  it("threshold edge: 0.55 inclusive on premium axis", () => {
    expect(classify(0.6, 0.55)).toBe("Curator");
    expect(classify(0.6, 0.549)).toBe("Forager");
  });
});

describe("classifySecondary", () => {
  it("returns undefined when both axes are clearly in one quadrant", () => {
    expect(classifySecondary(0.85, 0.85)).toBeUndefined();
    expect(classifySecondary(0.20, 0.20)).toBeUndefined();
  });
  it("returns the cross-axis identity when on borderline novelty", () => {
    // novelty=0.58 (within band), premium=0.85 (clear) → primary Curator,
    // secondary should be Steward (premium side, opposite novelty)
    const sec = classifySecondary(0.58, 0.85);
    expect(sec).toBe("Steward");
  });
  it("returns the cross-axis identity when on borderline premium", () => {
    // novelty=0.85 (clear), premium=0.58 (within band) → primary Curator,
    // secondary should be Forager (novelty side, opposite premium)
    const sec = classifySecondary(0.85, 0.58);
    expect(sec).toBe("Forager");
  });
});

// ----------------------------------------------------------------------------
// 4. Low-data + missing-data graceful handling
// ----------------------------------------------------------------------------
describe("getUserPalateProfile — low data", () => {
  it("returns Learning identity when totalVisits < 4", async () => {
    const profile = await getUserPalateProfile(makeData({ totalVisits: 0 }), { useSmoothing: false });
    expect(profile.primaryIdentity).toBe("Learning");
    expect(profile.confidence).toBe("low");
  });

  it("returns Learning at 1 visit", async () => {
    const profile = await getUserPalateProfile(makeData({ totalVisits: 1 }), { useSmoothing: false });
    expect(profile.primaryIdentity).toBe("Learning");
  });

  it("returns Learning at 3 visits (boundary)", async () => {
    const profile = await getUserPalateProfile(makeData({ totalVisits: 3 }), { useSmoothing: false });
    expect(profile.primaryIdentity).toBe("Learning");
  });

  it("classifies normally at exactly 4 visits", async () => {
    const profile = await getUserPalateProfile(
      makeData({
        totalVisits: 4, newPlaceRate: 0.8, cuisineDiversity: 0.8,
        neighborhoodDiversity: 0.8, repeatRate: 0.2,
        normalizedPriceLevel: 0.2,
      }),
      { useSmoothing: false },
    );
    expect(profile.primaryIdentity).toBe("Forager");
  });
});

describe("getUserPalateProfile — missing data fallback", () => {
  it("never throws when scores have NaN inputs (clamped to neutral)", async () => {
    const broken = makeData({
      // Simulate adapter producing NaN (shouldn't happen, but defensive)
      newPlaceRate: NaN, repeatRate: NaN,
    });
    const profile = await getUserPalateProfile(broken, { useSmoothing: false });
    expect(profile.noveltyScore).toBeGreaterThanOrEqual(0);
    expect(profile.noveltyScore).toBeLessThanOrEqual(1);
  });
});

// ----------------------------------------------------------------------------
// 5. Stability — smoothing prevents identity flipping from minor changes
// ----------------------------------------------------------------------------
describe("applySmoothing", () => {
  it("blends 70/30 between current and prior week", () => {
    const result = applySmoothing(
      { novelty: 0.8, premium: 0.4 },
      { novelty: 0.4, premium: 0.8, identity: "Steward", isoWeekStart: "2026-04-27" },
    );
    expect(result.novelty).toBeCloseTo(0.8 * 0.7 + 0.4 * 0.3, 3); // 0.68
    expect(result.premium).toBeCloseTo(0.4 * 0.7 + 0.8 * 0.3, 3); // 0.52
  });

  it("returns current unchanged when no prior week exists", () => {
    const result = applySmoothing({ novelty: 0.8, premium: 0.4 }, null);
    expect(result.novelty).toBe(0.8);
    expect(result.premium).toBe(0.4);
  });
});

describe("getUserPalateProfile — stability under smoothing", () => {
  it("smoothing prevents identity flipping when current week barely crosses threshold", async () => {
    // Last week was clearly Curator; this week dips just below threshold to 0.50/0.50
    // Without smoothing → Anchor (flipped). With smoothing 0.50*0.7 + 0.85*0.3 = 0.605 → still Curator.
    const profile = await getUserPalateProfile(
      makeData({
        totalVisits: 10,
        newPlaceRate: 0.50, cuisineDiversity: 0.50, neighborhoodDiversity: 0.50, repeatRate: 0.50,
        normalizedPriceLevel: 0.50, independentRestaurantRate: 0.50,
        reservationOrOccasionSignal: 0.50, elevatedCategorySignal: 0.50,
      }),
      {
        useSmoothing: true,
        priorWeekOverride: { novelty: 0.85, premium: 0.85, identity: "Curator", isoWeekStart: "2026-04-27" },
      },
    );
    expect(profile.primaryIdentity).toBe("Curator");
  });

  it("small week-to-week noise doesn't flip identity", async () => {
    const baseData = makeData({
      totalVisits: 10,
      newPlaceRate: 0.70, cuisineDiversity: 0.70, neighborhoodDiversity: 0.70, repeatRate: 0.30,
      normalizedPriceLevel: 0.30, independentRestaurantRate: 0.30,
      reservationOrOccasionSignal: 0.30, elevatedCategorySignal: 0.30,
    });
    const baseProfile = await getUserPalateProfile(baseData, { useSmoothing: false });
    expect(baseProfile.primaryIdentity).toBe("Forager");

    // Add ±0.05 noise across all signals
    const noisyData = makeData({
      ...baseData,
      newPlaceRate: 0.65, cuisineDiversity: 0.65, neighborhoodDiversity: 0.75, repeatRate: 0.35,
    });
    const noisyProfile = await getUserPalateProfile(noisyData, {
      useSmoothing: true,
      priorWeekOverride: {
        novelty: baseProfile.noveltyScore, premium: baseProfile.premiumScore,
        identity: baseProfile.primaryIdentity, isoWeekStart: "2026-04-27",
      },
    });
    expect(noisyProfile.primaryIdentity).toBe("Forager");  // didn't flip
  });
});
