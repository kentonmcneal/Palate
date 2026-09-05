// ============================================================================
// place-heat.ts — where the city is eating, from data we actually have.
// ----------------------------------------------------------------------------
// One definer RPC (0095). No Google call. `regime` says what the number
// means, and the UI must say it too:
//   palate   -> people on Palate have been here lately. Real heat.
//   velocity -> Google review count is climbing. The city's momentum.
//   baseline -> nothing recent from anyone; this is "popular", not "hot".
// ============================================================================

import { supabase } from "./supabase";

export type HeatRegime = "palate" | "velocity" | "baseline";

export type HotPlace = {
  google_place_id: string;
  name: string;
  latitude: number;
  longitude: number;
  cuisine_type: string | null;
  heat: number;
  regime: HeatRegime;
  palate_visits_7d: number;
  palate_visits_30d: number;
  saves: number;
  review_delta_30d: number | null;
  rating: number | null;
  user_rating_count: number | null;
};

export async function placeHeat(
  here: { lat: number; lng: number },
  opts: { radiusM?: number; limit?: number } = {},
): Promise<HotPlace[]> {
  const { data, error } = await supabase.rpc("place_heat", {
    p_lat: here.lat,
    p_lng: here.lng,
    p_radius_m: opts.radiusM ?? 6000,
    p_limit: opts.limit ?? 12,
  });
  if (error) throw error;
  return ((data ?? []) as HotPlace[]).filter(
    (p) => typeof p.latitude === "number" && typeof p.longitude === "number",
  );
}

/** What the card says above the map, given what the data can honestly claim. */
export function heatHeadline(places: HotPlace[]): { title: string; sub: string } | null {
  if (places.length === 0) return null;
  const top = places[0];
  if (top.regime === "palate") {
    const n = places.filter((p) => p.regime === "palate").length;
    return {
      title: "Where Palate is eating",
      sub: n === 1 ? "One place lit up this week." : `${n} places lit up this week.`,
    };
  }
  if (top.regime === "velocity") {
    return { title: "Picking up steam", sub: "Review counts climbing fastest near you." };
  }
  return { title: "Popular near you", sub: "Nobody on Palate has been lately. These are the crowd's picks." };
}

/** How many "people" dots to draw around a marker. */
export function crowdSize(p: HotPlace): number {
  if (p.regime !== "palate") return 0;
  return Math.max(1, Math.min(5, p.palate_visits_30d + p.saves));
}
