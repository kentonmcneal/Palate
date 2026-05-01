// ============================================================================
// restaurant-ranking.ts — Bucketed discovery feed.
// ----------------------------------------------------------------------------
// Returns a structured feed in 5 buckets:
//   1. Safe Matches       — high-fit, familiar
//   2. Stretch Picks       — slightly outside pattern but plausible (15-25% novelty)
//   3. Aspirational Picks  — aligned with wishlist
//   4. Trending Around You — popular nearby, fit-adjusted
//   5. Friends Like This   — saved/visited by accepted friends
//
// 80/20 explore/exploit baked in via the safe:stretch ratio.
// Diversity constraints prevent: 7 burgers in a row, all one neighborhood,
// all one price tier, no exploration.
// ============================================================================

import { supabase } from "./supabase";
import type { TasteVector } from "./taste-vector";
import {
  calculatePalateMatchScore,
  type PalateMatchScore,
  type ScoreContext,
  type RestaurantInput,
} from "./palate-match-score";
import { loadUserRecCounters } from "./recommendation-events";

export type RankedRestaurant = RestaurantInput & {
  match: PalateMatchScore;
  /** km from user, when available */
  distanceKm?: number | null;
};

export type DiscoveryBuckets = {
  safe: RankedRestaurant[];
  stretch: RankedRestaurant[];
  aspirational: RankedRestaurant[];
  trending: RankedRestaurant[];
  friends: RankedRestaurant[];
};

export type RankerOptions = {
  vector: TasteVector | null;
  candidates: RestaurantInput[];
  here?: { lat: number; lng: number };
  now?: Date;
  /** How many to return per bucket. Default 6. */
  perBucket?: number;
};

const DEFAULT_PER_BUCKET = 6;
const STRETCH_RATIO = 0.2; // 80/20 explore/exploit
const STRETCH_NOVELTY_FLOOR = 0.4; // novelty subscore must be at least this for stretch
const STRETCH_NOVELTY_CEIL = 0.85; // and not so novel it's nonsensical

// ----------------------------------------------------------------------------
// Public entry point
// ----------------------------------------------------------------------------
export async function rankRestaurantsForDiscovery(
  opts: RankerOptions,
): Promise<DiscoveryBuckets> {
  const { vector, candidates, here, now } = opts;
  const perBucket = opts.perBucket ?? DEFAULT_PER_BUCKET;
  const ctxBase: ScoreContext = { here, now, intent: "neutral" };

  // 1. Score every candidate twice — once neutral (for safe/trending),
  //    once with stretch intent (for stretch/aspirational).
  const placeIds = candidates.map((c) => c.google_place_id);
  const counters = await loadUserRecCounters(placeIds);

  const scored = candidates.map((r) => {
    const neutral = calculatePalateMatchScore(vector, r, ctxBase);
    const c = counters[r.google_place_id];
    // Penalize previously dismissed/skipped places
    const penalty = c ? (c.dismisses * 8 + c.skips * 4) : 0;
    return {
      restaurant: r,
      neutral: { ...neutral, score: Math.max(0, neutral.score - penalty) },
    };
  });

  // 2. Bucket into safe / stretch / aspirational / trending / friends.
  // 2a. SAFE — high-fit + familiar (low novelty subscore)
  const safe = scored
    .filter((s) => s.neutral.breakdown.novelty < 50 && s.neutral.score >= 60)
    .sort((a, b) => b.neutral.score - a.neutral.score);

  // 2b. STRETCH — moderate fit, novelty 40-85 (in the "interesting but not random" band)
  const stretch = scored
    .filter((s) =>
      s.neutral.breakdown.novelty >= STRETCH_NOVELTY_FLOOR * 100 &&
      s.neutral.breakdown.novelty <= STRETCH_NOVELTY_CEIL * 100 &&
      s.neutral.score >= 50,
    )
    .map((s) => {
      // Re-score with stretch intent — bumps the reasons accordingly
      const restretch = calculatePalateMatchScore(vector, s.restaurant, { ...ctxBase, intent: "stretch" });
      return { restaurant: s.restaurant, scored: restretch };
    })
    .sort((a, b) => b.scored.score - a.scored.score);

  // 2c. ASPIRATIONAL — high aspirational subscore
  const aspirational = scored
    .filter((s) => s.neutral.breakdown.aspirational >= 55)
    .map((s) => ({ restaurant: s.restaurant, scored: calculatePalateMatchScore(vector, s.restaurant, { ...ctxBase, intent: "aspirational" }) }))
    .sort((a, b) => b.scored.breakdown.aspirational - a.scored.breakdown.aspirational);

  // 2d. TRENDING — high social proof + decent fit
  const trending = scored
    .filter((s) => (s.restaurant.user_rating_count ?? 0) >= 500 && s.neutral.score >= 55)
    .sort((a, b) => (b.restaurant.user_rating_count ?? 0) - (a.restaurant.user_rating_count ?? 0));

  // 2e. FRIENDS LIKE THIS — places saved/visited by accepted friends
  const friendsBucket = await loadFriendsBucket(scored, ctxBase, vector);

  // 3. Apply diversity constraints + 80/20 explore/exploit on the safe bucket.
  const safeOut = applyDiversity(safe.map((s) => ({ restaurant: s.restaurant, scored: s.neutral })), perBucket);
  const safeMixed = mixIn80_20(safeOut, stretch.map((s) => ({ restaurant: s.restaurant, scored: s.scored })), perBucket);

  return {
    safe: safeMixed.map(toRanked).slice(0, perBucket),
    stretch: stretch.map(toRanked).slice(0, perBucket),
    aspirational: aspirational.map(toRanked).slice(0, perBucket),
    trending: trending.map((s) => ({ restaurant: s.restaurant, scored: s.neutral })).map(toRanked).slice(0, perBucket),
    friends: friendsBucket.slice(0, perBucket),
  };
}

// ----------------------------------------------------------------------------
// Diversity constraints — no >2 of same cuisine, no >3 in same neighborhood,
// must include at least one different price tier if the list is >= 4.
// ----------------------------------------------------------------------------
function applyDiversity(
  items: { restaurant: RestaurantInput; scored: PalateMatchScore }[],
  target: number,
): { restaurant: RestaurantInput; scored: PalateMatchScore }[] {
  const cuisineCount = new Map<string, number>();
  const neighborhoodCount = new Map<string, number>();
  const priceSeen = new Set<number>();
  const out: typeof items = [];

  for (const it of items) {
    if (out.length >= target * 2) break; // leave headroom for mix
    const c = it.restaurant.cuisine_subregion ?? it.restaurant.cuisine_region ?? it.restaurant.cuisine_type ?? "_";
    const n = it.restaurant.neighborhood ?? "_";
    if ((cuisineCount.get(c) ?? 0) >= 2) continue;
    if ((neighborhoodCount.get(n) ?? 0) >= 3) continue;
    out.push(it);
    cuisineCount.set(c, (cuisineCount.get(c) ?? 0) + 1);
    neighborhoodCount.set(n, (neighborhoodCount.get(n) ?? 0) + 1);
    if (it.restaurant.price_level != null) priceSeen.add(it.restaurant.price_level);
  }

  // If we lack price diversity, swap in a different-tier item from the unused tail
  if (out.length >= 4 && priceSeen.size === 1) {
    const onlyTier = [...priceSeen][0];
    const swap = items.find((i) =>
      !out.includes(i) &&
      i.restaurant.price_level != null &&
      i.restaurant.price_level !== onlyTier,
    );
    if (swap) {
      out.pop();
      out.push(swap);
    }
  }

  return out;
}

// ----------------------------------------------------------------------------
// 80/20 mix — every 5th slot is a stretch pick, when stretch candidates exist.
// ----------------------------------------------------------------------------
function mixIn80_20<T>(safe: T[], stretchPool: T[], target: number): T[] {
  const out: T[] = [];
  let safeIdx = 0;
  let stretchIdx = 0;
  for (let slot = 0; slot < target; slot++) {
    const isStretchSlot = (slot + 1) % 5 === 0; // slots 5, 10, 15…
    if (isStretchSlot && stretchPool[stretchIdx]) {
      out.push(stretchPool[stretchIdx++]);
    } else if (safe[safeIdx]) {
      out.push(safe[safeIdx++]);
    } else if (stretchPool[stretchIdx]) {
      out.push(stretchPool[stretchIdx++]);
    } else {
      break;
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Friends bucket — grab restaurants saved/visited by accepted friends
// ----------------------------------------------------------------------------
async function loadFriendsBucket(
  scored: { restaurant: RestaurantInput; neutral: PalateMatchScore }[],
  ctx: ScoreContext,
  vector: TasteVector | null,
): Promise<RankedRestaurant[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    // Find restaurant_ids visited by friends (RLS blocks non-friends already).
    const { data: friendVisits } = await supabase
      .from("visits")
      .select("restaurant_id, restaurant:restaurants(google_place_id, name)")
      .neq("user_id", user.id)
      .order("visited_at", { ascending: false })
      .limit(100);

    const friendIds = new Set(
      (friendVisits ?? [])
        .map((r: any) => Array.isArray(r.restaurant) ? r.restaurant[0]?.google_place_id : r.restaurant?.google_place_id)
        .filter(Boolean),
    );

    return scored
      .filter((s) => friendIds.has(s.restaurant.google_place_id))
      .map((s) => ({ restaurant: s.restaurant, scored: s.neutral }))
      .sort((a, b) => b.scored.score - a.scored.score)
      .map(toRanked);
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------
function toRanked(s: { restaurant: RestaurantInput; scored: PalateMatchScore }): RankedRestaurant {
  return { ...s.restaurant, match: s.scored };
}
