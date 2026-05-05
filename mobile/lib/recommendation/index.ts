// ============================================================================
// recommendation/index.ts — public API + canonical compatibility cache.
// ----------------------------------------------------------------------------
// CONSISTENCY RULE (per spec): compatibility is calculated ONCE per
// (user, restaurant). All surfaces must reference the same value.
//
// This module owns the cache. Cache invalidates whenever the personal signal
// invalidates (new visit, new rating, new dismiss). Cache is per-process
// (in-memory) — it gets rebuilt on app launch.
// ============================================================================

import type { Compatibility, RestaurantInput, RankedRestaurant } from "./types";
import type { TasteGraph } from "./taste-graph";
import { computeCompatibility } from "./compatibility";
import { scoreRestaurant } from "./scoring";
import { onPersonalSignalInvalidate } from "../personal-signal";

export * from "./types";
export { buildTasteGraph, assembleGraph, type TasteGraph } from "./taste-graph";
export { computeCompatibility } from "./compatibility";
export { scoreRestaurant, scoreContext } from "./scoring";
export { generateCandidates, type Candidate } from "./candidates";
export { rerank, type RerankOptions } from "./reranking";
export { explainCompatibility, explainRightNow, type RightNowExplanation } from "./explanations";
export { composeWrapped, type WrappedSummary } from "./wrapped";
export { computeRightNow, type RightNowPick, type RightNowResult } from "./right-now";
export { classifyIdentity, classifyFromGraph } from "./identity";

// ----------------------------------------------------------------------------
// Compatibility cache — keyed by graph snapshot id + place_id.
// ----------------------------------------------------------------------------

let cacheGraphId: string | null = null;
const cache = new Map<string, Compatibility>();

/** Bust the cache — call when the user's data changes. */
export function invalidateCompatibilityCache(): void {
  cacheGraphId = null;
  cache.clear();
}

// Subscribe to personal-signal invalidations so we re-score automatically
// when the user logs a visit, rates an item, or dismisses a rec.
onPersonalSignalInvalidate(invalidateCompatibilityCache);

/**
 * Get the canonical compatibility for (graph, restaurant). If the graph has
 * changed since the last call, the cache is rebuilt for this user.
 *
 * The "graphId" is a stable hash of the graph's totals so we don't recompute
 * when the graph object identity changes but the underlying data didn't.
 */
export function getCompatibility(graph: TasteGraph, r: RestaurantInput): Compatibility {
  const gid = makeGraphId(graph);
  if (gid !== cacheGraphId) {
    cache.clear();
    cacheGraphId = gid;
  }
  const key = r.google_place_id;
  let c = cache.get(key);
  if (!c) {
    c = computeCompatibility(graph, r);
    cache.set(key, c);
  }
  return c;
}

/**
 * Build a `RankedRestaurant` from a restaurant + graph + context. Uses the
 * canonical compatibility cache so every screen agrees on the headline % match.
 */
export function buildRankedRestaurant(
  graph: TasteGraph,
  r: RestaurantInput,
  ctx: { here?: { lat: number; lng: number }; now?: Date; mode?: "right_now" | "browsing" | "trip_planning" } = {},
): RankedRestaurant {
  const compat = getCompatibility(graph, r);
  const score = scoreRestaurant(graph, r, ctx);
  const km = (ctx.here && r.latitude != null && r.longitude != null)
    ? haversineKm(ctx.here, { lat: r.latitude, lng: r.longitude })
    : null;
  return {
    ...r,
    score,
    match: {
      score: compat.score,            // headline = compatibility (context-FREE), per spec
      confidence: compat.confidence,
      reasons: compat.reasons,
      matchedSignals: compat.matchedSignals,
      stretchSignals: [],
      breakdown: {
        taste: compat.breakdown.tasteFit,
        behavior: compat.breakdown.behaviorFit,
        context: score.contextFit,
        novelty: compat.breakdown.noveltyFit,
        aspirational: 0,
        social: compat.breakdown.socialTrendFit,
      },
    },
    distanceKm: km,
  };
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

function makeGraphId(g: TasteGraph): string {
  // Cheap stable hash — totals + a couple of map sizes capture every relevant
  // change to compatibility output.
  return [
    g.totalVisits,
    g.uniqueRestaurants,
    g.itemSentimentByRestaurant.size,
    g.itemSentimentByCuisine.size,
    g.friendVisitsByPlace.size,
    g.dismissesByPlace.size,
    g.skipsByPlace.size,
  ].join(":");
}
