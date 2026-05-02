// ============================================================================
// nearby-cache.ts — short-TTL local cache for nearbyRestaurants() responses.
// ----------------------------------------------------------------------------
// Quantizes lat/lng to ~150m buckets so small movements don't bust the cache,
// then stores the result in AsyncStorage with a 5-minute TTL. Used by
// Discover + Home so a tab switch doesn't trigger a fresh Places API call.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Restaurant } from "./places";

const TTL_MS = 5 * 60_000;            // 5 minutes
const QUANTIZE = 0.0015;              // ~150m at NYC latitude
const KEY_PREFIX = "palate.nearby.v1.";

function bucket(lat: number, lng: number, radius: number): string {
  const qLat = Math.round(lat / QUANTIZE) * QUANTIZE;
  const qLng = Math.round(lng / QUANTIZE) * QUANTIZE;
  return `${KEY_PREFIX}${qLat.toFixed(4)}_${qLng.toFixed(4)}_${radius}`;
}

export async function getCachedNearby(
  lat: number, lng: number, radius_m: number,
): Promise<Restaurant[] | null> {
  try {
    const raw = await AsyncStorage.getItem(bucket(lat, lng, radius_m));
    if (!raw) return null;
    const { savedAt, places } = JSON.parse(raw) as { savedAt: number; places: Restaurant[] };
    if (Date.now() - savedAt > TTL_MS) return null;
    return places;
  } catch {
    return null;
  }
}

export async function setCachedNearby(
  lat: number, lng: number, radius_m: number, places: Restaurant[],
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      bucket(lat, lng, radius_m),
      JSON.stringify({ savedAt: Date.now(), places }),
    );
  } catch {
    // ignore — cache failure is non-fatal
  }
}
