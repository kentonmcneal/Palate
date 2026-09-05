// ============================================================================
// cuisine-catalogue.ts — the cuisines you could ask for, not the ones you eat.
// ----------------------------------------------------------------------------
// The mood row has been built from two sources, and both were the wrong shape
// for the question being asked.
//
//   1. The user's own cuisine breakdown. A cuisine you have never eaten cannot
//      appear, which rules out the exact case a mood is for.
//   2. The nearby candidate pool. Better, but that pool is a Google fetch with
//      a small radius, already filtered and capped, so a cuisine with no venue
//      in that particular slice is still unaskable.
//
// The founder's version of this: "If I toggle to steakhouses and never eat
// steak it should still pull in top steakhouses." Filtering a list that has no
// steakhouse in it does not do that, and neither does asking Google for one.
//
// So ask the catalogue. `restaurants` holds 1043 classified rows, already paid
// for, and every read here is a Postgres query against them. No Google call, no
// spend, nothing rate-limited: the cost of offering a cuisine is now zero, so
// the row can offer everything that exists.
//
// LIVE, from the founder's own last visit (35.098, -89.841): 138 places inside
// the 8km box, 16 distinct cuisines, and steakhouse returns 3.
// ============================================================================

import { supabase } from "./supabase";
import type { Restaurant } from "./places";
import { filterRecommendable } from "./recommendation/eligibility";

/** Wider than the recommendation fetch on purpose. Asking for a cuisine you
 *  never eat is a decision to travel a bit; 2.5km would answer "no steakhouse"
 *  in most of a city that has several. */
export const CATALOGUE_RADIUS_M = 8000;

export type CuisineCount = { cuisine: string; place_count: number };

/**
 * Every cuisine with at least one recommendable place near you, commonest
 * first. Free, and independent of what the user has ever eaten.
 */
export async function cuisinesNear(
  lat: number,
  lng: number,
  radiusM = CATALOGUE_RADIUS_M,
): Promise<CuisineCount[]> {
  const { data, error } = await supabase.rpc("cuisines_near", {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: radiusM,
  });
  if (error) throw error;
  return (data ?? []) as CuisineCount[];
}

/**
 * The best places of one cuisine near you.
 *
 * Ranked by rating, because this is the branch where personal fit is exactly
 * what we do not have. The caller still scores each row against the taste graph
 * and still says plainly that these are not your usual — a low match here is
 * information, not a reason to hide the place.
 */
export async function restaurantsByCuisine(
  lat: number,
  lng: number,
  cuisine: string,
  opts: { radiusM?: number; limit?: number } = {},
): Promise<Restaurant[]> {
  const { data, error } = await supabase.rpc("restaurants_by_cuisine", {
    p_lat: lat,
    p_lng: lng,
    p_cuisine: cuisine,
    p_radius_m: opts.radiusM ?? CATALOGUE_RADIUS_M,
    p_limit: opts.limit ?? 20,
  });
  if (error) throw error;
  return (data ?? []) as Restaurant[];
}

/**
 * Merge the catalogue's cuisines into whatever the caller already had.
 *
 * The nearby pool stays first where the two agree: those places are closer and
 * already scored, so a chip backed by them lands on a better list. The
 * catalogue then adds everything else that exists within reach.
 */
export function mergeCuisinePools(
  pool: Array<{ cuisine_type?: string | null }>,
  catalogue: CuisineCount[],
): Array<{ cuisine_type?: string | null }> {
  const seen = new Set(
    pool.map((p) => (p.cuisine_type ?? "").toLowerCase().trim()).filter(Boolean),
  );
  const extra: Array<{ cuisine_type?: string | null }> = [];
  for (const c of catalogue) {
    const key = (c.cuisine ?? "").toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // One entry is enough: nearbyCuisines only needs presence, and repeating a
    // cuisine place_count times would rank the catalogue above the live pool.
    extra.push({ cuisine_type: c.cuisine });
  }
  return [...pool, ...extra];
}

/**
 * Recommendable places of one cuisine near you, ready to be scored.
 *
 * The same eligibility gate every other surface runs, applied here so a chip
 * can never route somebody to a place the rest of the app refuses to show.
 * Returns [] rather than throwing: a cuisine with nothing behind it is an
 * answer, and the caller has a real message for it.
 */
export async function cuisineCandidates(
  here: { lat: number; lng: number },
  cuisine: string,
  limit = 20,
): Promise<Restaurant[]> {
  const rows = await restaurantsByCuisine(here.lat, here.lng, cuisine, { limit });
  return filterRecommendable(rows as any) as unknown as Restaurant[];
}


// ----------------------------------------------------------------------------
// Dishes (0099). Same shape as cuisines, second axis.
// ----------------------------------------------------------------------------
export type DishCount = { dish: string; place_count: number };

export async function dishesNear(lat: number, lng: number, radiusM = CATALOGUE_RADIUS_M): Promise<DishCount[]> {
  const { data, error } = await supabase.rpc("dishes_near", { p_lat: lat, p_lng: lng, p_radius_m: radiusM });
  if (error) throw error;
  return (data ?? []) as DishCount[];
}

export async function dishCandidates(
  here: { lat: number; lng: number },
  dish: string,
  limit = 20,
): Promise<Restaurant[]> {
  const { data, error } = await supabase.rpc("restaurants_by_dish", {
    p_lat: here.lat, p_lng: here.lng, p_dish: dish, p_radius_m: CATALOGUE_RADIUS_M, p_limit: limit,
  });
  if (error) throw error;
  return filterRecommendable((data ?? []) as any) as unknown as Restaurant[];
}


/**
 * Everything recommendable in the catalogue within a radius, best first.
 * Zero Google spend: this is the depth Discover was missing when one
 * 20-result Nearby call, minus chains, minus places you have been, left a
 * handful.
 */
export async function restaurantsNear(
  here: { lat: number; lng: number },
  opts: { radiusM?: number; limit?: number } = {},
): Promise<Restaurant[]> {
  const { data, error } = await supabase.rpc("restaurants_near", {
    p_lat: here.lat, p_lng: here.lng, p_radius_m: opts.radiusM ?? 5000, p_limit: opts.limit ?? 150,
  });
  if (error) throw error;
  return (data ?? []) as Restaurant[];
}
