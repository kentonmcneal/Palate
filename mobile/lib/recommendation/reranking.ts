// ============================================================================
// recommendation/reranking.ts — apply UX rules over a scored list.
// ----------------------------------------------------------------------------
// Inputs are already-scored RankedRestaurant[]. Reranking applies:
//   A. Diversity      — caps cuisine, neighborhood, chain repetition
//   B. Freshness      — soft demotes places the user has dismissed/skipped
//   C. Novelty        — interleaves stretch picks at known cadence
//   D. Repetition     — penalizes places visited many times (in recs feed only)
//   E. Availability   — drops/penalizes closed places when openHint is set
//   F. Distance       — already in scoring; reranker just enforces a cap
//   G. Confidence     — when low, prefers safer picks (lower novelty)
// ============================================================================

import type { RankedRestaurant } from "./types";

const CUISINE_CAP = 2;       // max same-cuisine in a single list
const NEIGHBORHOOD_CAP = 3;  // max same-neighborhood
const STRETCH_INTERVAL = 5;  // every 5th slot is a stretch pick if available

export type RerankOptions = {
  /** Cap output length. */
  limit?: number;
  /** Apply availability penalty (closed → drop) when restaurant.is_open is known. */
  enforceOpen?: boolean;
  /** Maximum distance in km — drop anything farther. */
  maxDistanceKm?: number;
  /** Inject stretch picks at every Nth slot. Default true. */
  interleaveStretch?: boolean;
};

/**
 * The diversity rule on its own, for callers whose items are not
 * RankedRestaurant.
 *
 * Three picks that are all burgers is not a choice, it is the same suggestion
 * three times. Home shipped exactly that: ranked against the founder's real
 * graph, the top ten of the two-hundred-place Memphis pool were ten American
 * restaurants. The cap is what turns a ranking into a shortlist.
 *
 * Order is otherwise preserved: this is a greedy pass that skips an item whose
 * key is already at the cap and comes back for it only if the list would
 * otherwise be short. Nothing is dropped that would leave a gap.
 */
export function capByKey<T>(
  items: T[],
  keyOf: (t: T) => string | null | undefined,
  cap: number,
  limit: number,
): T[] {
  const counts = new Map<string, number>();
  const out: T[] = [];
  const skipped: T[] = [];
  for (const it of items) {
    if (out.length >= limit) break;
    const k = (keyOf(it) ?? "").toLowerCase();
    const n = k ? (counts.get(k) ?? 0) : 0;
    if (k && n >= cap) { skipped.push(it); continue; }
    if (k) counts.set(k, n + 1);
    out.push(it);
  }
  // A thin pool must never come back shorter because of the cap.
  for (const it of skipped) {
    if (out.length >= limit) break;
    out.push(it);
  }
  return out;
}

export function rerank(items: RankedRestaurant[], opts: RerankOptions = {}): RankedRestaurant[] {
  const limit = opts.limit ?? items.length;

  // Distance gate (G/F)
  let pool = items;
  if (opts.maxDistanceKm != null) {
    pool = pool.filter((r) => r.distanceKm == null || r.distanceKm <= opts.maxDistanceKm!);
  }

  // Availability gate (E) — only when caller has open data
  if (opts.enforceOpen) {
    pool = pool.filter((r) => (r as any).is_open !== false);
  }

  // Split stretch vs. main so we can interleave deterministically (C)
  const stretchPool = pool.filter((r) => r.score.recommendationType === "stretch");
  const mainPool = pool.filter((r) => r.score.recommendationType !== "stretch");

  // Diversity-respecting greedy fill (A)
  const cuisineCount = new Map<string, number>();
  const hoodCount = new Map<string, number>();
  const out: RankedRestaurant[] = [];
  let mainIdx = 0;
  let stretchIdx = 0;

  for (let slot = 0; slot < limit && (mainIdx < mainPool.length || stretchIdx < stretchPool.length); slot++) {
    const isStretchSlot = (opts.interleaveStretch ?? true) && (slot + 1) % STRETCH_INTERVAL === 0;
    const tryStretchFirst = isStretchSlot && stretchPool[stretchIdx];

    let next: RankedRestaurant | null = null;

    if (tryStretchFirst) {
      next = takeNextDiverse(stretchPool, stretchIdx, cuisineCount, hoodCount);
      if (next) stretchIdx = stretchPool.indexOf(next) + 1;
    }
    if (!next) {
      next = takeNextDiverse(mainPool, mainIdx, cuisineCount, hoodCount);
      if (next) mainIdx = mainPool.indexOf(next) + 1;
    }
    // Fall back to relaxed diversity if we run out of "diverse" picks
    if (!next) {
      next = mainPool[mainIdx] ?? stretchPool[stretchIdx] ?? null;
      if (next === mainPool[mainIdx]) mainIdx++;
      else if (next === stretchPool[stretchIdx]) stretchIdx++;
    }
    if (!next) break;

    out.push(next);
    bumpCount(cuisineCount, cuisineKey(next));
    bumpCount(hoodCount, next.neighborhood ?? "_");
  }

  return out;
}

// ----------------------------------------------------------------------------
// Pick the next item that doesn't break diversity caps. Returns null if all
// remaining items violate caps.
// ----------------------------------------------------------------------------
function takeNextDiverse(
  pool: RankedRestaurant[],
  startIdx: number,
  cuisineCount: Map<string, number>,
  hoodCount: Map<string, number>,
): RankedRestaurant | null {
  for (let i = startIdx; i < pool.length; i++) {
    const r = pool[i];
    const c = cuisineKey(r);
    const n = r.neighborhood ?? "_";
    if ((cuisineCount.get(c) ?? 0) >= CUISINE_CAP) continue;
    if ((hoodCount.get(n) ?? 0) >= NEIGHBORHOOD_CAP) continue;
    return r;
  }
  return null;
}

function cuisineKey(r: RankedRestaurant): string {
  return r.cuisine_subregion ?? r.cuisine_region ?? r.cuisine_type ?? "_";
}

function bumpCount(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
