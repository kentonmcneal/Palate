// ============================================================================
// recommendation/taste-graph.ts — formal weighted user→entity relationships.
// ----------------------------------------------------------------------------
// Wraps the existing TasteVector (visit-derived) and the PersonalSignal
// (event-driven: saves, dismisses, item ratings, friends) into one graph
// the scorers consume. Behavior weights match the spec:
//   logged visit:    +8
//   repeat visit:    +12
//   save:            +5
//   share:           +6
//   click/search:    +2
//   skip:            -3
//   dismiss:         -4
//   bad rating:     -10
// All event signals decay with a 30-day half-life (matches taste-vector).
// ============================================================================

import { computeTasteVector, type TasteVector } from "../taste-vector";
import { loadPersonalSignal, type PersonalSignal } from "../personal-signal";

export type EntityWeight = { key: string; weight: number };

export type TasteGraph = {
  // Weighted relationships (sorted high→low within each map)
  cuisines: Record<string, number>;
  cuisinesSubregion: Record<string, number>;
  formats: Record<string, number>;
  occasions: Record<string, number>;
  flavors: Record<string, number>;
  neighborhoods: Record<string, number>;
  priceLevels: Record<string, number>;
  hours: number[];                 // 24 buckets
  // Restaurant-level: visit count by google_place_id
  restaurantVisits: Record<string, number>;
  // Item-level sentiment per restaurant (loved/ok/not_for_me)
  itemSentimentByRestaurant: Map<string, { loved: number; ok: number; not_for_me: number }>;
  // Item-level sentiment aggregated to cuisine for cross-learning
  itemSentimentByCuisine: Map<string, { loved: number; not_for_me: number }>;
  // Friend visits
  friendVisitsByPlace: Map<string, number>;
  // Negative event counts
  dismissesByPlace: Map<string, number>;
  skipsByPlace: Map<string, number>;
  // Aggregate behavioral metrics
  totalVisits: number;
  uniqueRestaurants: number;
  repeatRate: number;
  explorationRate: number;
  averagePriceLevel: number;
  weekendShare: number;
  neighborhoodLoyalty: number;
  geographicSpreadKm: number;
  topNeighborhoods: { name: string; weight: number }[];
  /** Confidence in the graph itself: low (<3 visits), medium (3-12), high (12+). */
  dataDepth: "low" | "medium" | "high";
};

export async function buildTasteGraph(): Promise<TasteGraph> {
  const [vector, personal] = await Promise.all([
    computeTasteVector().catch(() => null),
    loadPersonalSignal().catch(() => null),
  ]);
  return assembleGraph(vector, personal);
}

export function assembleGraph(vector: TasteVector | null, personal: PersonalSignal | null): TasteGraph {
  const v = vector ?? emptyVector();
  const p = personal ?? emptyPersonal();
  const visitsByPlace: Record<string, number> = {};
  for (const [k, n] of p.visitsByPlaceId.entries()) visitsByPlace[k] = n;

  return {
    cuisines: v.cuisineRegion,
    cuisinesSubregion: v.cuisineSubregion,
    formats: v.formatClass,
    occasions: v.occasion,
    flavors: v.flavor,
    neighborhoods: v.topNeighborhoods.reduce((acc, n) => {
      acc[n.name] = n.weight;
      return acc;
    }, {} as Record<string, number>),
    priceLevels: v.priceTier,
    hours: v.hourly,
    restaurantVisits: visitsByPlace,
    itemSentimentByRestaurant: p.itemSentimentByRestaurantId,
    itemSentimentByCuisine: p.itemSentimentByCuisine,
    friendVisitsByPlace: p.friendVisitsByPlaceId,
    dismissesByPlace: p.dismissesByPlaceId,
    skipsByPlace: p.skipsByPlaceId,
    totalVisits: v.visitCount,
    uniqueRestaurants: v.uniqueRestaurants,
    repeatRate: v.repeatRate,
    explorationRate: v.explorationRate,
    averagePriceLevel: v.averagePriceLevel,
    weekendShare: v.weekendShare,
    neighborhoodLoyalty: v.neighborhoodLoyalty,
    geographicSpreadKm: v.geographicSpreadKm,
    topNeighborhoods: v.topNeighborhoods,
    dataDepth: v.visitCount >= 12 ? "high" : v.visitCount >= 3 ? "medium" : "low",
  };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

export function shareOf(map: Record<string, number>, key: string): number {
  const total = Object.values(map).reduce((s, n) => s + n, 0);
  return total > 0 ? (map[key] ?? 0) / total : 0;
}

export function topKey(map: Record<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of Object.entries(map)) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}

function emptyVector(): TasteVector {
  return {
    visitCount: 0, wishlistCount: 0,
    cuisineRegion: {}, cuisineSubregion: {},
    cuisineRegionAspirational: {}, cuisineSubregionAspirational: {},
    formatClass: {}, priceTier: {}, chainType: {}, occasion: {}, flavor: {},
    culturalContext: {},
    topNeighborhoods: [], neighborhoodLoyalty: 0, geographicSpreadKm: 0,
    hourly: new Array(24).fill(0), dowCounts: new Array(7).fill(0),
    weekendShare: 0, repeatRate: 0, explorationRate: 1,
    uniqueRestaurants: 0, averagePriceLevel: 0, priceSpread: 0,
    aspirationalGap: 0, aspirationTags: {},
  };
}

function emptyPersonal(): PersonalSignal {
  return {
    visitsByPlaceId: new Map(),
    visitsByRestaurantId: new Map(),
    dismissesByPlaceId: new Map(),
    skipsByPlaceId: new Map(),
    itemSentimentByRestaurantId: new Map(),
    itemSentimentByCuisine: new Map(),
    friendVisitsByPlaceId: new Map(),
  };
}
