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
import { computeCompatibility } from "./compatibility";

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
    confidenceScore * FINAL_W.confidence;

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
  brunch:    ["brunch", "breakfast"],
  lunch:     ["working_lunch", "casual_solo"],
  dinner:    ["date_night", "group_dinner", "casual_solo"],
  late_night:["late_night"],
};

function currentSlot(d: Date): keyof typeof SLOT_TO_OCCASIONS {
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
