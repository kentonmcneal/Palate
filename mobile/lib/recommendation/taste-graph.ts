// ============================================================================
// recommendation/taste-graph.ts — formal weighted user→entity relationships.
// ----------------------------------------------------------------------------
// Wraps the TasteVector (visit-derived) and the PersonalSignal (ratings,
// friends, "Not interested", and the per-place feedback ledger) into one
// graph the scorers consume.
//
// Two kinds of thing live here and the distinction is load-bearing:
//   • attribute maps (cuisines, formats, ...) — built from visits and saves,
//     read by compatibility.ts, and therefore what the displayed % match
//     rests on. Only explicit acts reach them.
//   • per-place ledgers (feedbackByPlace, placeSentiment, friendVisits) —
//     read per restaurant. Implicit feedback lives ONLY in feedbackByPlace
//     and is applied in scoring.ts, so it changes order and never the %.
// ============================================================================

import { computeTasteVector, type TasteVector } from "../taste-vector";
import { EMPTY_DISLIKES, type DislikeProfile } from "../dislikes";
import { loadPersonalSignal, type PersonalSignal } from "../personal-signal";
import { EMPTY_FEEDBACK, type FeedbackLedger } from "./feedback";

export type EntityWeight = { key: string; weight: number };

export type TasteGraph = {
  // Weighted relationships (sorted high→low within each map)
  cuisines: Record<string, number>;
  cuisinesSubregion: Record<string, number>;
  cuisineTypes: Record<string, number>;
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
  /** google_place_id → dish-level sentiment, the key the scorer can use.
   *  See personal-signal.ts: the restaurant_id map above was unreadable by
   *  compatibility.ts, so a loved dish never helped its own restaurant. */
  itemSentimentByPlace: Map<string, { loved: number; ok: number; not_for_me: number }>;
  // Item-level sentiment aggregated to cuisine for cross-learning
  itemSentimentByCuisine: Map<string, { loved: number; not_for_me: number }>;
  // Friend visits
  friendVisitsByPlace: Map<string, number>;
  /** How the person rated their own visits to a place (visits.overall_rating). */
  placeSentiment: Map<string, { loved: number; ok: number; not_for_me: number }>;
  /** Implicit feedback, per place, bounded and decayed (feedback.ts). */
  feedbackByPlace: FeedbackLedger;
  // "Not interested": excluded ids and the learned profile (lib/dislikes.ts)
  dislikes: DislikeProfile;
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
    // Saves count, at 40% of a visit. A wishlist entry is the most explicit
    // statement of intent the app collects — "I want to go here" — and
    // assembleGraph dropped it on the floor: the aspirational maps were
    // computed by taste-vector.ts and read by nothing that scores. A save is
    // weaker evidence than actually going, hence 0.4, not 1.
    cuisines: blendAspiration(v.cuisineRegion, v.cuisineRegionAspirational),
    cuisinesSubregion: blendAspiration(v.cuisineSubregion, v.cuisineSubregionAspirational),
    // Saves reach cuisine_type too. It is the best-populated cuisine column
    // and the one this blend skipped, so a save taught region and subregion
    // (42% null) and said nothing to the field 77% of rows carry.
    cuisineTypes: blendAspiration(v.cuisineType ?? {}, v.cuisineTypeAspirational),
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
    itemSentimentByPlace: p.itemSentimentByPlaceId,
    itemSentimentByCuisine: p.itemSentimentByCuisine,
    friendVisitsByPlace: p.friendVisitsByPlaceId,
    placeSentiment: p.placeSentimentByPlaceId,
    feedbackByPlace: p.feedbackByPlaceId,
    dislikes: p.dislikes ?? EMPTY_DISLIKES,
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

const ASPIRATION_WEIGHT = 0.4;

function blendAspiration(
  visited: Record<string, number>,
  saved: Record<string, number> | undefined,
): Record<string, number> {
  if (!saved) return visited;
  const out: Record<string, number> = { ...visited };
  for (const [k, n] of Object.entries(saved)) {
    out[k] = (out[k] ?? 0) + n * ASPIRATION_WEIGHT;
  }
  return out;
}

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

export function emptyVector(): TasteVector {
  return {
    visitCount: 0, wishlistCount: 0,
    cuisineRegion: {}, cuisineSubregion: {}, cuisineType: {},
    cuisineRegionAspirational: {}, cuisineSubregionAspirational: {}, cuisineTypeAspirational: {},
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
    itemSentimentByRestaurantId: new Map(),
    itemSentimentByPlaceId: new Map(),
    itemSentimentByCuisine: new Map(),
    placeSentimentByPlaceId: new Map(),
    friendVisitsByPlaceId: new Map(),
    feedbackByPlaceId: EMPTY_FEEDBACK,
    dislikes: EMPTY_DISLIKES,
  };
}
