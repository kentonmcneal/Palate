// ============================================================================
// recommendation/scoring.ts — finalScore composition (context-aware).
// ----------------------------------------------------------------------------
// Per spec:
//   finalScore = compatibilityScore * 0.60 + contextFit * 0.30 + confidence * 0.10
// Compatibility comes from compatibility.ts (single source of truth).
// Context comes from `scoreContext` here — distance, time-of-day, open-now.
// Returns the formal RestaurantScore with full breakdown.
// ============================================================================

import type {
  RestaurantInput, RestaurantScore, RecommendationType, ScoreContext,
} from "./types";
import type { TasteGraph } from "./taste-graph";
import { shareOf } from "./taste-graph";
import { computeCompatibility } from "./compatibility";
import { gemAdjustment } from "./gems";

const FINAL_W = {
  compatibility: 0.60,
  context:       0.30,
  confidence:    0.10,
};

// ----------------------------------------------------------------------------
// Public entry — called by candidate ranking + right-now engine.
// ----------------------------------------------------------------------------
export function scoreRestaurant(
  graph: TasteGraph,
  r: RestaurantInput,
  ctx: ScoreContext = {},
  opts?: { recommendationType?: RecommendationType },
): RestaurantScore {
  const compat = computeCompatibility(graph, r);
  const contextFit = scoreContext(r, ctx);
  const confidenceScore = confidenceToScore(compat.confidence);

  // Normalize each input to 0..100 then apply spec weights
  const final =
    compat.score * FINAL_W.compatibility +
    contextFit   * FINAL_W.context +
    confidenceScore * FINAL_W.confidence +
    // Gems-first: a strong boost/penalty from objective quality/price/aesthetic/
    // acclaim signals so genuine gems rise and ordinary places sink to fallback.
    gemAdjustment(r) +
    // Keep cafés/coffee shops from crowding out actual restaurants in recs.
    cafeFormatAdjustment(graph, r, ctx);

  return {
    restaurantId: r.google_place_id,
    finalScore: Math.round(Math.min(99, Math.max(0, final))),
    compatibilityScore: compat.score,
    confidenceScore,
    tasteFit: compat.breakdown.tasteFit,
    contextFit,
    behaviorFit: compat.breakdown.behaviorFit,
    noveltyFit: compat.breakdown.noveltyFit,
    qualityFit: compat.breakdown.qualityFit,
    socialTrendFit: compat.breakdown.socialTrendFit,
    explanation: compat.reasons[0] ?? "",
    recommendationType: opts?.recommendationType ?? inferType(compat, contextFit),
  };
}

// ----------------------------------------------------------------------------
// Context fit — 0..100. Considers distance, time-of-day, and (when known)
// open-now. Pure function of (restaurant, ctx).
// ----------------------------------------------------------------------------
export function scoreContext(r: RestaurantInput, ctx: ScoreContext): number {
  let score = 50; // neutral default

  // Distance — 0km = +30, 8km+ = -30
  if (ctx.here && r.latitude != null && r.longitude != null) {
    const km = haversineKm(ctx.here, { lat: r.latitude, lng: r.longitude });
    score += clamp(60 * (1 - km / 8), -30, 30);
  }

  // Time-of-day — occasion tags vs. current hour/dow
  if (ctx.now && r.occasion_tags?.length) {
    const slot = currentSlot(ctx.now);
    const wanted = SLOT_TO_OCCASIONS[slot];
    const hits = r.occasion_tags.filter((t) => wanted.includes(t)).length;
    score += Math.min(15, hits * 7);
  }

  // Mode multiplier — "right_now" amplifies context, "browsing" softens it
  if (ctx.mode === "browsing") {
    // Pull context fit toward neutral so novelty/taste dominate
    score = 50 + (score - 50) * 0.5;
  } else if (ctx.mode === "trip_planning") {
    // Distance matters less when planning ahead
    score = 50 + (score - 50) * 0.6;
  }

  return clamp(Math.round(score), 0, 100);
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const SLOT_TO_OCCASIONS: Record<string, string[]> = {
  breakfast: ["breakfast", "brunch"],
  brunch:    ["brunch", "breakfast", "family_gathering"],
  lunch:     ["working_lunch", "casual_solo", "quick_bite", "business_dinner"],
  dinner:    ["date_night", "group_dinner", "casual_solo", "celebration", "business_dinner", "family_gathering"],
  late_night:["late_night", "party"],
};

// Cafés, coffee shops, bakeries and dessert spots flood a nearby search and win
// on proximity, but they're rarely the "nice restaurant" someone wants for a
// meal. Demote them — unless the user has actually shown they gravitate there
// (their own café share cancels the penalty), and soften at breakfast/brunch
// when a café is a legitimate pick.
const CAFE_FORMATS = new Set(["café", "cafe", "bakery", "dessert"]);

type CafeKind = "coffee" | "bakery" | "dessert";

/**
 * How much of the café penalty applies in each part of the day, per format.
 * The demotion exists because these places flood a nearby search and win on
 * proximity — not because they are bad answers. WHEN decides which it is.
 *
 * A coffee shop at 8am is not a compromise, it is the right answer, so the
 * penalty vanishes entirely. The same place at 8pm almost never is. Dessert
 * runs the opposite way: nobody wants a dessert bar for breakfast, and it is a
 * genuinely good call after dinner or late at night.
 *
 * 0 = no penalty · 1 = full penalty · >1 = worse than the baseline.
 */
const CAFE_SLOT_WEIGHT: Record<CafeKind, Record<keyof typeof SLOT_TO_OCCASIONS, number>> = {
  coffee:  { breakfast: 0,   brunch: 0.2, lunch: 0.6, dinner: 1,   late_night: 1.2 },
  bakery:  { breakfast: 0,   brunch: 0.2, lunch: 0.7, dinner: 1,   late_night: 1 },
  // Dessert inverts: bad in the morning, one of the better answers after a meal.
  dessert: { breakfast: 1,   brunch: 0.8, lunch: 0.8, dinner: 0.5, late_night: 0.2 },
};

function cafeKind(formatClass: string): CafeKind {
  if (formatClass === "dessert") return "dessert";
  if (formatClass === "bakery") return "bakery";
  return "coffee";
}

export function cafeFormatAdjustment(
  graph: TasteGraph,
  r: RestaurantInput,
  ctx: ScoreContext,
): number {
  const fc = (r.format_class ?? "").toLowerCase();
  if (!CAFE_FORMATS.has(fc)) return 0;

  const kind = cafeKind(fc);
  const base = kind === "coffee" ? -20 : -12; // bakery/dessert start milder

  // Without a clock, fall back to the neutral middle of the day rather than
  // assuming the worst — an unknown time should not silently penalise.
  const slot = ctx.now ? currentSlot(ctx.now) : "lunch";
  const penalty = base * CAFE_SLOT_WEIGHT[kind][slot];

  // Users who genuinely favour cafés keep seeing them — their café share of
  // visits (×3, capped) scales the penalty back toward zero.
  const affinity = Math.min(1, shareOf(graph.formats, r.format_class ?? "") * 3);
  // `|| 0` normalises -0 (from multiplying by a zero weight) and any NaN from a
  // malformed graph. A negative zero in a score is harmless arithmetically and
  // confusing everywhere else.
  return (penalty * (1 - affinity)) || 0;
}

export function currentSlot(d: Date): keyof typeof SLOT_TO_OCCASIONS {
  const h = d.getHours();
  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
  if (h < 10) return "breakfast";
  if (h < 13 && isWeekend) return "brunch";
  if (h < 15) return "lunch";
  if (h < 22) return "dinner";
  return "late_night";
}

function confidenceToScore(c: "low" | "medium" | "high"): number {
  return c === "high" ? 90 : c === "medium" ? 70 : 45;
}

function inferType(compat: { score: number; breakdown: { noveltyFit: number } }, ctx: number): RecommendationType {
  if (compat.breakdown.noveltyFit >= 70) return "stretch";
  if (compat.score >= 80 && ctx >= 70) return "best_now";
  if (compat.score >= 75) return "comfort";
  return "nearby";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
