// "More like Almyra" — calls the Supabase `similar_restaurants` RPC, then
// hydrates each match with the restaurant fields the list needs.
//
// Two-trip on purpose: the RPC stays schema-stable (returns just id +
// score + signals); restaurant columns can evolve without touching the SQL.

import { supabase } from "./supabase";
import { loadPersonalSignal } from "./personal-signal";
import { isRecommendable, type EligibilityInput } from "./recommendation/eligibility";

export interface SimilarSignals {
  same_subregion: boolean;
  same_cuisine: boolean;
  same_region: boolean;
  same_neighborhood: boolean;
  same_format: boolean;
  price_diff: number;
  flavor_overlap: boolean;
  occasion_overlap: boolean;
}

export interface SimilarRestaurant {
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
  latitude: number | null;
  longitude: number | null;
  similarity_score: number;
  signals: SimilarSignals;
  why: string;
}

export async function loadSimilarRestaurants(
  sourceRestaurantId: string,
  opts: { includeVisited?: boolean; limit?: number } = {},
): Promise<SimilarRestaurant[]> {
  const hidden = (await loadPersonalSignal().catch(() => null))?.dislikes.placeIds ?? null;
  // The RPC reads `auth.uid()` server-side — we don't pass a user id from the
  // client. That avoids leaking another user's visit history via the filter.
  const { data: matches, error } = await supabase.rpc("similar_restaurants", {
    source_id: sourceRestaurantId,
    result_limit: opts.limit ?? 25,
    include_visited: opts.includeVisited ?? false,
  });
  if (error) throw error;
  if (!matches || matches.length === 0) return [];

  const ids = (matches as Array<{ restaurant_id: string }>).map((m) => m.restaurant_id);
  // Read from the override-resolved view so user corrections win.
  const { data: restaurants, error: hydrateErr } = await supabase
    .from("restaurants_resolved")
    .select(
      "id, google_place_id, name, cuisine_type:resolved_cuisine_type, cuisine_subregion:resolved_cuisine_subregion, neighborhood, address, price_level, rating, user_rating_count, latitude, longitude, chain_name, primary_type, types, format_class:resolved_format_class, recommendation_eligibility",
    )
    .in("id", ids);
  // A transient hydrate failure should surface, not masquerade as "no similar".
  if (hydrateErr) throw hydrateErr;

  const byId = new Map<string, any>((restaurants ?? []).map((r: any) => [r.id, r]));
  return (matches as Array<{ restaurant_id: string; similarity_score: number; signals: SimilarSignals }>)
    .map((m): SimilarRestaurant | null => {
      const r = byId.get(m.restaurant_id);
      if (!r) return null;
      return {
        ...r,
        similarity_score: Number(m.similarity_score),
        signals: m.signals,
        why: describeSimilarity(m.signals),
      };
    })
    .filter((r): r is SimilarRestaurant => r !== null)
    // "Find more like X" is a recommendation surface — same gate as the rest
    // (chains, fast food, non-gem cafés never proposed).
    .filter((r) => isRecommendable(r as unknown as EligibilityInput, { hidden }));
}

function describeSimilarity(s: SimilarSignals): string {
  const reasons: string[] = [];
  if (s.same_subregion) reasons.push("same regional style");
  else if (s.same_cuisine) reasons.push("same cuisine");
  else if (s.same_region) reasons.push("same region");
  if (s.same_neighborhood) reasons.push("same neighborhood");
  if (s.price_diff === 0) reasons.push("same price point");
  else if (s.price_diff === 1) reasons.push("similar price");
  if (s.flavor_overlap) reasons.push("similar flavors");
  return reasons.slice(0, 2).join(" · ");
}
