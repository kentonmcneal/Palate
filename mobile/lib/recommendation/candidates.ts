// ============================================================================
// recommendation/candidates.ts — generate candidate restaurants from 5 pools.
// ----------------------------------------------------------------------------
// Pools (per spec):
//   A. taste_similar      — cuisines/spots similar to user's pattern
//   B. context_nearby     — nearby + open + time-appropriate
//   C. stretch_adjacent   — slightly outside usual cuisine/hood/price (NOT random)
//   D. social_trend       — friend-visited or locally popular
//   E. quality_baseline   — strong rating + review volume
//
// Each candidate is labeled with its source pool. The scorer + reranker use
// pool labels to drive routing (e.g. stretch slot prefers stretch_adjacent).
// Pools are deduplicated by google_place_id, with the most "personal" pool
// winning ties (taste_similar > stretch > social > context > quality).
// ============================================================================

import type { RestaurantInput, CandidatePool } from "./types";
import type { TasteGraph } from "./taste-graph";
import { shareOf } from "./taste-graph";
import { nearbyRestaurants } from "../places";

export type Candidate = {
  restaurant: RestaurantInput;
  pool: CandidatePool;
};

const POOL_PRIORITY: Record<CandidatePool, number> = {
  taste_similar:    5,
  saved:            4,
  stretch_adjacent: 3,
  social_trend:     2,
  context_nearby:   1,
  quality_baseline: 0,
};

export type GenerateOptions = {
  graph: TasteGraph;
  here: { lat: number; lng: number };
  /** Search radius in meters. Default 2500m. */
  radiusM?: number;
  /** Pre-fetched nearby (skip the network call when caller has it). */
  preFetched?: RestaurantInput[];
};

export async function generateCandidates(opts: GenerateOptions): Promise<Candidate[]> {
  const radius = opts.radiusM ?? 2500;
  const nearby = opts.preFetched
    ?? (await nearbyRestaurants(opts.here.lat, opts.here.lng, radius)).map(toInput);

  if (nearby.length === 0) return [];

  // Pool A — taste_similar: cuisine subregion or region overlaps with user pattern.
  const tasteSet = poolBy(nearby, (r) => {
    if (r.cuisine_subregion && shareOf(opts.graph.cuisinesSubregion, r.cuisine_subregion) >= 0.05) return true;
    if (r.cuisine_region && shareOf(opts.graph.cuisines, r.cuisine_region) >= 0.05) return true;
    return false;
  });

  // Pool B — context_nearby: physically close (kept broad — scoring will
  // refine via context fit; we just want to ensure proximity is represented).
  const nearbySet = poolBy(nearby, (r) => true);

  // Pool C — stretch_adjacent: cuisine NOT in pattern, but matches user's
  // explored region or shares a flavor/format the user already likes.
  const stretchSet = poolBy(nearby, (r) => {
    const inSubregion = r.cuisine_subregion && shareOf(opts.graph.cuisinesSubregion, r.cuisine_subregion) > 0;
    if (inSubregion) return false; // not stretch — already in pattern
    const adjacentRegion = r.cuisine_region && shareOf(opts.graph.cuisines, r.cuisine_region) > 0;
    const matchingFlavor = r.flavor_tags?.some((f) => (opts.graph.flavors[f] ?? 0) > 0);
    const matchingFormat = r.format_class && shareOf(opts.graph.formats, r.format_class) >= 0.1;
    return Boolean(adjacentRegion || matchingFlavor || matchingFormat);
  });

  // Pool D — social_trend: friend-visited OR high local popularity.
  const socialSet = poolBy(nearby, (r) => {
    const friends = opts.graph.friendVisitsByPlace.get(r.google_place_id) ?? 0;
    if (friends > 0) return true;
    return (r.user_rating_count ?? 0) >= 500;
  });

  // Pool E — quality_baseline: strong rating with sufficient review volume.
  const qualitySet = poolBy(nearby, (r) => {
    return (r.rating ?? 0) >= 4.3 && (r.user_rating_count ?? 0) >= 100;
  });

  // Saved pool — restaurants in the user's wishlist that are nearby.
  // (Placeholder: we'd ideally cross-reference wishlist here. For now, surface
  // restaurants the user has visited — they're "saved" by behavior.)
  const savedSet = poolBy(nearby, (r) => (opts.graph.restaurantVisits[r.google_place_id] ?? 0) >= 1);

  // Merge — most "personal" pool wins on dedupe.
  const merged = new Map<string, Candidate>();
  for (const [pool, set] of [
    ["taste_similar", tasteSet] as [CandidatePool, RestaurantInput[]],
    ["saved", savedSet] as [CandidatePool, RestaurantInput[]],
    ["stretch_adjacent", stretchSet] as [CandidatePool, RestaurantInput[]],
    ["social_trend", socialSet] as [CandidatePool, RestaurantInput[]],
    ["context_nearby", nearbySet] as [CandidatePool, RestaurantInput[]],
    ["quality_baseline", qualitySet] as [CandidatePool, RestaurantInput[]],
  ]) {
    for (const r of set) {
      const existing = merged.get(r.google_place_id);
      if (!existing || POOL_PRIORITY[pool] > POOL_PRIORITY[existing.pool]) {
        merged.set(r.google_place_id, { restaurant: r, pool });
      }
    }
  }
  return Array.from(merged.values());
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function poolBy(arr: RestaurantInput[], pred: (r: RestaurantInput) => boolean): RestaurantInput[] {
  return arr.filter(pred);
}

export function toInput(p: any): RestaurantInput {
  return {
    google_place_id: p.google_place_id,
    name: p.name,
    cuisine_type: p.cuisine_type ?? null,
    cuisine_region: p.cuisine_region ?? null,
    cuisine_subregion: p.cuisine_subregion ?? null,
    format_class: p.format_class ?? null,
    occasion_tags: p.occasion_tags ?? null,
    flavor_tags: p.flavor_tags ?? null,
    cultural_context: p.cultural_context ?? null,
    neighborhood: p.neighborhood ?? null,
    price_level: p.price_level ?? null,
    rating: p.rating ?? null,
    user_rating_count: p.user_rating_count ?? null,
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
  };
}
