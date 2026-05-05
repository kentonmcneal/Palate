// ============================================================================
// recommendation/identity.ts — palate identity classifier.
// ----------------------------------------------------------------------------
// Wraps the existing palate-labels rule engine and re-exports under the
// canonical recommendation/ namespace. Each identity carries:
//   • name           — 2-3 word label (e.g. "Late-Night Explorer")
//   • description    — what the identity means
//   • meaning        — behavioral implication (what people who score this do)
//   • secondary      — short one-sentence behavioral observation
//
// Identities are derived from the user's TasteVector (all-time) and an
// optional weekly vector for "weeklyMood".
// ============================================================================

export {
  generateIdentitySet,
  expandedLore,
  generateLore,
  type PalateIdentity,
  type PalateIdentitySet,
  type PalateLore,
  FALLBACK_LABEL_COUNT,
} from "../palate-labels";

import { generateIdentitySet, type PalateIdentity } from "../palate-labels";
import type { TasteGraph } from "./taste-graph";
import { computeTasteVector } from "../taste-vector";

/**
 * Top-level entry — async, builds the identity set from the live taste vector.
 * For sync use, callers can pass an already-computed TasteVector to
 * `generateIdentitySet` directly.
 */
export async function classifyIdentity(): Promise<PalateIdentity | null> {
  const v = await computeTasteVector().catch(() => null);
  if (!v || v.visitCount === 0) return null;
  return generateIdentitySet(v).primary;
}

/** Identity classification fed by a graph snapshot (sync). */
export function classifyFromGraph(graph: TasteGraph): PalateIdentity | null {
  if (graph.totalVisits === 0) return null;
  // Re-derive a TasteVector-shaped object from the graph for compatibility
  // with the existing rule engine. This is cheap.
  const synthetic = {
    visitCount: graph.totalVisits, wishlistCount: 0,
    cuisineRegion: graph.cuisines, cuisineSubregion: graph.cuisinesSubregion,
    cuisineRegionAspirational: {}, cuisineSubregionAspirational: {},
    formatClass: graph.formats, priceTier: graph.priceLevels, chainType: {},
    occasion: graph.occasions, flavor: graph.flavors,
    culturalContext: {},
    topNeighborhoods: graph.topNeighborhoods, neighborhoodLoyalty: graph.neighborhoodLoyalty,
    geographicSpreadKm: graph.geographicSpreadKm,
    hourly: graph.hours, dowCounts: new Array(7).fill(0),
    weekendShare: graph.weekendShare, repeatRate: graph.repeatRate,
    explorationRate: graph.explorationRate,
    uniqueRestaurants: graph.uniqueRestaurants, averagePriceLevel: graph.averagePriceLevel,
    priceSpread: 0, aspirationalGap: 0, aspirationTags: {},
  };
  return generateIdentitySet(synthetic as any).primary;
}
