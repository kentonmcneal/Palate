// Wishlist-anchored recommendations.
//
// One RPC (`recommendations_from_saves`) does anchor selection, similarity,
// aggregation, and de-dup server-side. We fetch the anchor names in parallel
// for the "Because you saved..." subtitle (the RPC's matched_against only
// includes anchors that produced at least one match, which can drop names
// the user expects to see). Then a single batch hydrate.

import { supabase } from "./supabase";
import { isRecommendable, type EligibilityInput } from "./recommendation/eligibility";
import {
  CAFE_FORMATS, CAFE_SLOT_WEIGHT, cafeKind, currentSlot,
} from "./recommendation/scoring";

export interface SaveAnchoredRec {
  id: string;
  google_place_id: string;
  name: string;
  cuisine_type: string | null;
  cuisine_subregion: string | null;
  neighborhood: string | null;
  address: string | null;
  price_level: number | null;
  rating: number | null;
  user_rating_count: number | null;
  matchedAgainst: string[];
  totalScore: number;
  format_class?: string | null;
}

/**
 * How much to demote a save-anchored café at the current hour, as a multiplier.
 *
 * The ranked Discover path has applied a time-of-day café penalty for a while;
 * this rail never did, so at 11:57pm Home was recommending a smoothie café and
 * a coffee shop off the back of three dinner restaurants. The saves rail orders
 * by the RPC's raw similarity score, which is why the fix could not simply
 * reuse cafeFormatAdjustment: that returns an ABSOLUTE penalty tuned to a
 * 0-100 compatibility score, and adding it to a score on a different scale
 * would be arbitrary. This is multiplicative, so it behaves the same whatever
 * the RPC's numbers look like.
 *
 * The slot table itself is shared, so the two surfaces cannot disagree about
 * when a coffee shop is a good idea.
 *
 * `formatAffinity` is the user's share of visits by format: somebody who
 * genuinely lives in cafés keeps seeing them.
 */
export function cafeTimeMultiplier(
  formatClass: string | null | undefined,
  now: Date,
  formatAffinity: Record<string, number> = {},
): number {
  const fc = (formatClass ?? "").toLowerCase();
  if (!CAFE_FORMATS.has(fc)) return 1;

  const weight = CAFE_SLOT_WEIGHT[cafeKind(fc)][currentSlot(now)];
  const total = Object.values(formatAffinity).reduce((sum, n) => sum + n, 0);
  const share = total > 0 ? (formatAffinity[fc] ?? 0) / total : 0;
  const affinity = Math.min(1, share * 3);

  // At breakfast the weight is 0 and this is exactly 1 — a coffee shop in the
  // morning is the right answer, not a compromise, and must not be demoted.
  const demotion = Math.min(0.85, 0.7 * weight * (1 - affinity));
  return 1 - demotion;
}

/** Re-rank save-anchored recs for the time of day. Pure, so it can be tested. */
export function rankSavesRecs<T extends { totalScore: number; format_class?: string | null }>(
  recs: T[],
  now: Date,
  formatAffinity: Record<string, number> = {},
): T[] {
  return [...recs]
    .map((r) => ({ r, k: r.totalScore * cafeTimeMultiplier(r.format_class, now, formatAffinity) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.r);
}

export interface RecsFromSavesResult {
  anchors: Array<{ id: string; name: string }>;
  recs: SaveAnchoredRec[];
}

export async function loadRecsFromSaves(
  opts: {
    maxAnchors?: number;
    perAnchorLimit?: number;
    resultLimit?: number;
    /** User's current location — bounds matches to nearby so out-of-town saves
     *  don't surface out-of-town recs. Omit to skip the geo filter. */
    here?: { lat: number; lng: number } | null;
    /** Clock for the café time-of-day demotion. Injectable for tests. */
    now?: Date;
    /** The user's share of visits by format, so café regulars still see cafés. */
    formatAffinity?: Record<string, number>;
  } = {},
): Promise<RecsFromSavesResult> {
  const maxAnchors = opts.maxAnchors ?? 5;
  const perAnchorLimit = opts.perAnchorLimit ?? 12;
  const resultLimit = opts.resultLimit ?? 12;

  // Anchors (for the subtitle) and matches run in parallel — same wall-clock
  // as a single round-trip on warm connections.
  const [anchorsRes, matchesRes] = await Promise.all([
    supabase
      .from("wishlist")
      .select("restaurant:restaurants(id, name)")
      .order("added_at", { ascending: false })
      .limit(maxAnchors),
    supabase.rpc("recommendations_from_saves", {
      max_anchors: maxAnchors,
      per_anchor_limit: perAnchorLimit,
      result_limit: resultLimit,
      p_lat: opts.here?.lat ?? null,
      p_lng: opts.here?.lng ?? null,
    }),
  ]);
  if (matchesRes.error) throw matchesRes.error;

  const anchors: Array<{ id: string; name: string }> = [];
  for (const row of (anchorsRes.data ?? []) as Array<{ restaurant: any }>) {
    const r = Array.isArray(row.restaurant) ? row.restaurant[0] : row.restaurant;
    if (r?.id && r?.name) anchors.push({ id: r.id, name: r.name });
  }
  if (anchors.length === 0) return { anchors: [], recs: [] };

  const matchRows = (matchesRes.data ?? []) as Array<{
    restaurant_id: string;
    total_score: number;
    matched_against: string[];
  }>;
  if (matchRows.length === 0) return { anchors, recs: [] };

  const ids = matchRows.map((m) => m.restaurant_id);
  const { data: restaurants, error: hydrateErr } = await supabase
    .from("restaurants_resolved")
    .select(
      "id, google_place_id, name, cuisine_type:resolved_cuisine_type, cuisine_subregion:resolved_cuisine_subregion, neighborhood, address, price_level, rating, user_rating_count, chain_name, primary_type, types, format_class:resolved_format_class, recommendation_eligibility",
    )
    .in("id", ids);
  // Propagate a transient hydrate failure instead of silently returning [] —
  // an empty result would be indistinguishable from "no recommendations."
  if (hydrateErr) throw hydrateErr;
  const byId = new Map<string, any>((restaurants ?? []).map((r: any) => [r.id, r]));

  const recs: SaveAnchoredRec[] = [];
  for (const m of matchRows) {
    const r = byId.get(m.restaurant_id);
    if (!r) continue;
    // Save-anchored recs are recommendations — same shared gate.
    if (!isRecommendable(r as EligibilityInput)) continue;
    recs.push({
      ...r,
      totalScore: Number(m.total_score),
      matchedAgainst: m.matched_against ?? [],
    });
  }

  return {
    anchors,
    recs: rankSavesRecs(recs, opts.now ?? new Date(), opts.formatAffinity ?? {}),
  };
}
