// Wishlist-anchored recommendations.
//
// One RPC (`recommendations_from_saves`) does anchor selection, similarity,
// aggregation, and de-dup server-side. We fetch the anchor names in parallel
// for the "Because you saved..." subtitle (the RPC's matched_against only
// includes anchors that produced at least one match, which can drop names
// the user expects to see). Then a single batch hydrate.

import { supabase } from "./supabase";

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
      "id, google_place_id, name, cuisine_type:resolved_cuisine_type, cuisine_subregion:resolved_cuisine_subregion, neighborhood, address, price_level, rating, user_rating_count",
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
    recs.push({
      ...r,
      totalScore: Number(m.total_score),
      matchedAgainst: m.matched_against,
    });
  }

  return { anchors, recs };
}
