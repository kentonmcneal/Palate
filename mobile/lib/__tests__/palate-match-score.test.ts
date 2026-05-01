// ============================================================================
// palate-match-score.test.ts — scenario tests for the Palate Match Score.
// ----------------------------------------------------------------------------
// Self-contained assertions using a tiny `expect` helper. Runnable via:
//   npx tsx lib/__tests__/palate-match-score.test.ts
// (requires `tsx` — install with: npm i -D tsx)
//
// If/when we add Jest/Vitest, the `it()` blocks already use familiar shape.
// ============================================================================

import { calculatePalateMatchScore, type RestaurantInput } from "../palate-match-score";
import type { TasteVector } from "../taste-vector";

// ---- minimal test harness --------------------------------------------------
let passed = 0;
let failed = 0;

function it(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function describe(name: string, fn: () => void) {
  console.log(`\n${name}`);
  fn();
}

function expect(v: any) {
  return {
    toBeGreaterThan: (n: number) => { if (!(v > n)) throw new Error(`expected ${v} > ${n}`); },
    toBeGreaterThanOrEqual: (n: number) => { if (!(v >= n)) throw new Error(`expected ${v} >= ${n}`); },
    toBeLessThan: (n: number) => { if (!(v < n)) throw new Error(`expected ${v} < ${n}`); },
    toBeLessThanOrEqual: (n: number) => { if (!(v <= n)) throw new Error(`expected ${v} <= ${n}`); },
    toBe: (n: any) => { if (v !== n) throw new Error(`expected ${JSON.stringify(v)} === ${JSON.stringify(n)}`); },
    toContain: (s: string) => {
      const ok = Array.isArray(v) ? v.some((x) => String(x).toLowerCase().includes(s.toLowerCase()))
                                   : String(v).toLowerCase().includes(s.toLowerCase());
      if (!ok) throw new Error(`expected ${JSON.stringify(v)} to contain "${s}"`);
    },
  };
}

// ---- vector + restaurant builders ------------------------------------------
function emptyVector(): TasteVector {
  return {
    visitCount: 0, wishlistCount: 0,
    cuisineRegion: {}, cuisineSubregion: {},
    cuisineRegionAspirational: {}, cuisineSubregionAspirational: {},
    formatClass: {}, priceTier: {}, chainType: {},
    occasion: {}, flavor: {}, culturalContext: {},
    topNeighborhoods: [], neighborhoodLoyalty: 0, geographicSpreadKm: 0,
    hourly: new Array(24).fill(0), dowCounts: new Array(7).fill(0),
    weekendShare: 0, repeatRate: 0, explorationRate: 1,
    uniqueRestaurants: 0, averagePriceLevel: 0, priceSpread: 0,
    aspirationalGap: 0, aspirationTags: {},
  };
}

function restaurant(over: Partial<RestaurantInput>): RestaurantInput {
  return {
    google_place_id: over.google_place_id ?? "test-place",
    name: over.name ?? "Test Place",
    cuisine_type: null, cuisine_region: null, cuisine_subregion: null,
    format_class: null, occasion_tags: null, flavor_tags: null,
    cultural_context: null, neighborhood: null,
    price_level: null, rating: null, user_rating_count: null,
    latitude: null, longitude: null,
    ...over,
  };
}

// ============================================================================
// Scenarios
// ============================================================================

describe("Scenario 1 — brand new user with only quiz data (no visits)", () => {
  const v = emptyVector(); // visitCount=0, no signals
  const r = restaurant({ name: "Sweetgreen", cuisine_type: "healthy", format_class: "fast_casual", price_level: 2, rating: 4.4 });
  const m = calculatePalateMatchScore(v, r);

  it("returns a score in the [35, 99] range", () => {
    expect(m.score).toBeGreaterThanOrEqual(35);
    expect(m.score).toBeLessThanOrEqual(99);
  });

  it("reports low confidence", () => {
    expect(m.confidence).toBe("low");
  });

  it("still surfaces a reason (never empty)", () => {
    expect(m.reasons.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Scenario 2 — user repeats McDonald's 3x", () => {
  const v = emptyVector();
  v.visitCount = 3;
  v.repeatRate = 1.0;
  v.cuisineRegion = { american: 3 };
  v.cuisineSubregion = { burger: 3 };
  v.formatClass = { quick_service: 3 };
  v.priceTier = { "1": 3 };
  v.averagePriceLevel = 1;
  v.flavor = { rich: 3 };
  v.uniqueRestaurants = 1;

  it("scores another McDonald's-shaped quick-service burger HIGH", () => {
    const r = restaurant({ name: "Burger King", cuisine_type: "american", cuisine_region: "american", cuisine_subregion: "burger", format_class: "quick_service", price_level: 1, rating: 3.8 });
    const m = calculatePalateMatchScore(v, r);
    expect(m.score).toBeGreaterThanOrEqual(70);
    expect(m.matchedSignals).toContain("format");
  });

  it("scores an upscale steakhouse LOWER (different format + price tier)", () => {
    const r = restaurant({ name: "Peter Luger", cuisine_type: "steakhouse", cuisine_region: "american", cuisine_subregion: "steakhouse", format_class: "fine_dining", price_level: 4, rating: 4.6 });
    const m = calculatePalateMatchScore(v, r);
    expect(m.score).toBeLessThan(70); // worse than the burger match
  });
});

describe("Scenario 3 — user saves sushi/upscale on wishlist but eats fast casual", () => {
  const v = emptyVector();
  v.visitCount = 8;
  v.wishlistCount = 4;
  v.cuisineRegion = { american: 6, mediterranean: 2 };
  v.cuisineSubregion = { burger: 4, mediterranean_general: 2 };
  v.formatClass = { fast_casual: 8 };
  v.averagePriceLevel = 2;
  // Aspirational signal: sushi + upscale saved on wishlist
  v.cuisineRegionAspirational = { east_asian: 2, european: 2 };
  v.cuisineSubregionAspirational = { japanese_sushi: 2 };
  v.aspirationTags = { upscale: 2, date_night: 2 };

  it("scores actual fast-casual high", () => {
    const r = restaurant({ name: "Sweetgreen", cuisine_type: "healthy", cuisine_region: "american", format_class: "fast_casual", price_level: 2 });
    const m = calculatePalateMatchScore(v, r);
    expect(m.score).toBeGreaterThan(60);
  });

  it("recognizes a sushi spot as aspirational match", () => {
    const r = restaurant({ name: "Sushi Noz", cuisine_type: "japanese", cuisine_region: "east_asian", cuisine_subregion: "japanese_sushi", format_class: "fine_dining", price_level: 4 });
    const m = calculatePalateMatchScore(v, r, { intent: "aspirational" });
    expect(m.matchedSignals).toContain("aspirational");
    expect(m.breakdown.aspirational).toBeGreaterThanOrEqual(50);
  });
});

describe("Scenario 4 — user mostly eats in one neighborhood", () => {
  const v = emptyVector();
  v.visitCount = 15;
  v.topNeighborhoods = [
    { name: "Williamsburg", weight: 12 },
    { name: "Greenpoint", weight: 3 },
  ];
  v.neighborhoodLoyalty = 0.8;
  v.cuisineRegion = { italian: 5, american: 5, east_asian: 5 };
  v.formatClass = { casual_dining: 8, fast_casual: 7 };

  it("rewards a place in their loyalty neighborhood", () => {
    const here = { lat: 40.7100, lng: -73.9572 }; // Williamsburg
    const r = restaurant({
      name: "Lilia",
      cuisine_type: "italian", cuisine_region: "italian",
      neighborhood: "Williamsburg",
      format_class: "casual_dining", price_level: 3,
      latitude: 40.7155, longitude: -73.9598,
    });
    const m = calculatePalateMatchScore(v, r, { here });
    expect(m.score).toBeGreaterThan(65);
    expect(m.matchedSignals).toContain("nearby");
  });

  it("penalizes a place 12km away", () => {
    const here = { lat: 40.7100, lng: -73.9572 };
    const r = restaurant({
      name: "Some Far Place",
      cuisine_type: "italian", cuisine_region: "italian",
      neighborhood: "Astoria",
      format_class: "casual_dining", price_level: 3,
      latitude: 40.7700, longitude: -73.9100,
    });
    const m = calculatePalateMatchScore(v, r, { here });
    // distance penalty visible in context subscore
    expect(m.breakdown.context).toBeLessThan(60);
  });
});

describe("Scenario 5 — user repeatedly skips burger places (handled at ranker level)", () => {
  // The match score itself doesn't read skip history (that's the ranker's
  // job via loadUserRecCounters). Here we just confirm the score ITSELF
  // doesn't penalize a never-skipped burger purely from taste.
  const v = emptyVector();
  v.visitCount = 6;
  v.cuisineRegion = { american: 6 };
  v.cuisineSubregion = { burger: 6 };
  v.formatClass = { quick_service: 6 };
  v.averagePriceLevel = 1;

  it("scores a new burger spot HIGH from taste alone — ranker is responsible for skip penalty", () => {
    const r = restaurant({ name: "Five Guys", cuisine_type: "american", cuisine_region: "american", cuisine_subregion: "burger", format_class: "quick_service", price_level: 1 });
    const m = calculatePalateMatchScore(v, r);
    expect(m.score).toBeGreaterThanOrEqual(65);
  });
});

describe("Scenario 6 — user clicks stretch picks often (intent=stretch)", () => {
  const v = emptyVector();
  v.visitCount = 10;
  v.cuisineRegion = { american: 8, italian: 2 };
  v.cuisineSubregion = { burger: 5, italian_pizzeria: 3 };
  v.formatClass = { fast_casual: 7, quick_service: 3 };
  v.averagePriceLevel = 2;
  v.flavor = { rich: 5 };

  it("with intent=stretch, rewards novelty over familiarity", () => {
    const familiarBurger = restaurant({
      name: "Another Burger Spot",
      cuisine_type: "american", cuisine_region: "american", cuisine_subregion: "burger",
      format_class: "fast_casual", price_level: 2,
    });
    const novelKorean = restaurant({
      name: "Cote",
      cuisine_type: "korean", cuisine_region: "east_asian", cuisine_subregion: "korean_bbq",
      format_class: "casual_dining", price_level: 3,
    });
    const familiar = calculatePalateMatchScore(v, familiarBurger, { intent: "stretch" });
    const stretch = calculatePalateMatchScore(v, novelKorean, { intent: "stretch" });
    // Novelty subscore should be inverted between the two
    expect(stretch.breakdown.novelty).toBeGreaterThan(familiar.breakdown.novelty);
  });
});

// ============================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0 && typeof process !== "undefined") process.exit(1);
