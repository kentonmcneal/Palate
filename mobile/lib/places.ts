import { supabase } from "./supabase";

export type Restaurant = {
  id?: string;
  google_place_id: string;
  name: string;
  chain_name?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  primary_type?: string | null;
  cuisine_type?: string | null;
  neighborhood?: string | null;
  tags?: string[] | null;
  rating?: number | null;
  price_level?: number | null;
};

/** Calls the places-proxy edge function with a typed body. */
async function callProxy<T>(body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke("places-proxy", { body });
  if (error) throw error;
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as T;
}

export async function nearbyRestaurants(lat: number, lng: number, radius_m = 150) {
  const { places } = await callProxy<{ places: Restaurant[] }>({
    action: "nearby",
    lat,
    lng,
    radius_m,
  });
  return places;
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
  const { data, error } = await supabase
    .from("restaurants")
    .select("id")
    .eq("google_place_id", googlePlaceId)
    .single();
  if (error) throw error;
  return data.id as string;
}
