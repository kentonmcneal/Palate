import { supabase } from "./supabase";
import { readFunctionError } from "./function-error";

export type Restaurant = {
  id?: string;
  google_place_id: string;
  name: string;
  chain_name?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  primary_type?: string | null;
  /** Full Google Places `types[]` (e.g., ["restaurant", "italian_restaurant"]) */
  types?: string[] | null;
  cuisine_type?: string | null;
  neighborhood?: string | null;
  tags?: string[] | null;
  rating?: number | null;
  user_rating_count?: number | null;
  /** Google regularOpeningHours.periods, verbatim. Null means UNKNOWN. */
  regular_opening_hours?: unknown;
  price_level?: number | null;
  /** 0 = never recommend (chains/airports/hotels), 1 = full discovery. */
  recommendation_eligibility?: number | null;
  ineligibility_reason?: string | null;
};

/**
 * Calls the places-proxy edge function with a typed body.
 *
 * The error path matters more than it looks. supabase-js turns every non-2xx
 * into a FunctionsHttpError whose message is the fixed string "Edge Function
 * returned a non-2xx status code", and the proxy's own reply — `rate_limited`,
 * `places_failed`, `temporarily_unavailable` — is on `error.context`, unread.
 *
 * The map screen has shipped a written-out message for the rate-limit case
 * since it was added, guarded by `msg.includes("rate_limited")`, and that
 * substring could never appear: the proxy returns rate_limited as a 429, so
 * the thrown message was always the generic sentence. Every capped user saw
 * "check your connection" instead. Reading the body is what makes the message
 * the founder already wrote actually reachable.
 */
async function callProxy<T>(body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke("places-proxy", { body });
  if (error) throw new Error(await readFunctionError(error));
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as T;
}

export async function nearbyRestaurants(lat: number, lng: number, radius_m = 150) {
  const { places } = await nearbyRestaurantsDetailed(lat, lng, radius_m);
  return places;
}

/** Same call, with the proxy's `degraded` flag: true when the daily Google
 *  budget is spent and these are best-effort cached rows, which for passive
 *  capture means "do not conclude anything from an empty list". */
export async function nearbyRestaurantsDetailed(lat: number, lng: number, radius_m = 150) {
  const res = await callProxy<{ places: Restaurant[]; degraded?: boolean }>({
    action: "nearby",
    lat,
    lng,
    radius_m,
  });
  return { places: res.places, degraded: res.degraded === true };
}

/**
 * Suggestions from the catalogue we already hold. FREE — one Postgres query,
 * no Google, no proxy, no meter.
 *
 * This exists so a search bar can respond to every keystroke. `searchRestaurants`
 * below cannot: it goes through places-proxy to Google Places Text Search and
 * bills per call, so firing it per keystroke would multiply the cost of the
 * most-used path in the app. Local first, Google on submit.
 */
export async function searchRestaurantsLocal(
  query: string,
  near?: { lat: number; lng: number },
  limit = 8,
): Promise<Restaurant[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc("search_restaurants_local", {
    p_query: q,
    p_lat: near?.lat ?? null,
    p_lng: near?.lng ?? null,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as Restaurant[];
}

export async function searchRestaurants(query: string, near?: { lat: number; lng: number }) {
  const { places } = await callProxy<{ places: Restaurant[] }>({
    action: "search",
    query,
    ...(near ?? {}),
  });
  return places;
}

/** Once the proxy has upserted into restaurants, look up the row id for a place_id. */
export async function getRestaurantIdByPlaceId(googlePlaceId: string) {
  // maybeSingle (not single): .single() throws PGRST116 on zero rows, and this
  // is the first call in saveVisit — if the proxy hasn't upserted the row yet
  // (slow/failed), that would hard-crash the core log-a-visit flow. Throw a
  // clear, retryable error instead so the UI can surface it.
  const { data, error } = await supabase
    .from("restaurants")
    .select("id")
    .eq("google_place_id", googlePlaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Restaurant isn't ready yet. Try again in a moment.");
  return data.id as string;
}
