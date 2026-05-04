// ============================================================================
// browsing-location.ts — let users override their "browse location" so they
// can plan trips. Recommendations, Featured Lists, the map, and Discover all
// re-center to the picked city. Visit logging stays on real GPS only.
//
// Storage: AsyncStorage key 'palate.browsingCity.v1'.
// State sync: tiny pub/sub so any screen can subscribe via useBrowsingCity().
// ============================================================================

import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCurrentLocation } from "./location";

const STORAGE_KEY = "palate.browsingCity.v1";

export type BrowsingCity = {
  id: string;        // slug, e.g. "new-york"
  name: string;      // "New York"
  region: string;    // "NY", "FL"
  lat: number;
  lng: number;
};

// Curated city list — coords are downtown / cultural center.
// Add to this as users ask. Sorted by likelihood of trip planning, US-first.
export const POPULAR_CITIES: BrowsingCity[] = [
  { id: "new-york",     name: "New York",     region: "NY", lat: 40.7580, lng: -73.9855 },
  { id: "los-angeles",  name: "Los Angeles",  region: "CA", lat: 34.0522, lng: -118.2437 },
  { id: "san-francisco", name: "San Francisco", region: "CA", lat: 37.7749, lng: -122.4194 },
  { id: "miami",        name: "Miami",        region: "FL", lat: 25.7617, lng: -80.1918 },
  { id: "chicago",      name: "Chicago",      region: "IL", lat: 41.8781, lng: -87.6298 },
  { id: "austin",       name: "Austin",       region: "TX", lat: 30.2672, lng: -97.7431 },
  { id: "houston",      name: "Houston",      region: "TX", lat: 29.7604, lng: -95.3698 },
  { id: "dallas",       name: "Dallas",       region: "TX", lat: 32.7767, lng: -96.7970 },
  { id: "boston",       name: "Boston",       region: "MA", lat: 42.3601, lng: -71.0589 },
  { id: "seattle",      name: "Seattle",      region: "WA", lat: 47.6062, lng: -122.3321 },
  { id: "philadelphia", name: "Philadelphia", region: "PA", lat: 39.9526, lng: -75.1652 },
  { id: "washington-dc", name: "Washington DC", region: "DC", lat: 38.9072, lng: -77.0369 },
  { id: "atlanta",      name: "Atlanta",      region: "GA", lat: 33.7490, lng: -84.3880 },
  { id: "denver",       name: "Denver",       region: "CO", lat: 39.7392, lng: -104.9903 },
  { id: "nashville",    name: "Nashville",    region: "TN", lat: 36.1627, lng: -86.7816 },
  { id: "new-orleans",  name: "New Orleans",  region: "LA", lat: 29.9511, lng: -90.0715 },
  { id: "portland",     name: "Portland",     region: "OR", lat: 45.5152, lng: -122.6784 },
  { id: "san-diego",    name: "San Diego",    region: "CA", lat: 32.7157, lng: -117.1611 },
  { id: "las-vegas",    name: "Las Vegas",    region: "NV", lat: 36.1699, lng: -115.1398 },
  { id: "phoenix",      name: "Phoenix",      region: "AZ", lat: 33.4484, lng: -112.0740 },
  { id: "minneapolis",  name: "Minneapolis",  region: "MN", lat: 44.9778, lng: -93.2650 },
  { id: "detroit",      name: "Detroit",      region: "MI", lat: 42.3314, lng: -83.0458 },
  { id: "honolulu",     name: "Honolulu",     region: "HI", lat: 21.3099, lng: -157.8581 },
];

// ----------------------------------------------------------------------------
// State + pub/sub
// ----------------------------------------------------------------------------
let cached: BrowsingCity | null | undefined; // undefined = not yet loaded
const listeners = new Set<(c: BrowsingCity | null) => void>();

async function load(): Promise<BrowsingCity | null> {
  if (cached !== undefined) return cached;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    cached = raw ? (JSON.parse(raw) as BrowsingCity) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function getBrowsingCity(): Promise<BrowsingCity | null> {
  return await load();
}

export async function setBrowsingCity(city: BrowsingCity | null): Promise<void> {
  cached = city;
  if (city) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(city));
  } else {
    await AsyncStorage.removeItem(STORAGE_KEY);
  }
  for (const cb of listeners) cb(city);
}

/**
 * Returns the override coords if a city is picked, otherwise the real GPS.
 * Use this for browse-style queries (recs, discover, map). For visit logging,
 * keep using getCurrentLocation() — you can't log a visit from a city you're
 * not in.
 */
export async function getEffectiveLocation(): Promise<{ lat: number; lng: number; accuracy?: number } | null> {
  const c = await load();
  if (c) return { lat: c.lat, lng: c.lng, accuracy: 50 };
  return await getCurrentLocation();
}

export function useBrowsingCity(): [BrowsingCity | null, boolean] {
  const [city, setCity] = useState<BrowsingCity | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    load().then((c) => {
      if (!alive) return;
      setCity(c);
      setLoading(false);
    });
    const cb = (c: BrowsingCity | null) => alive && setCity(c);
    listeners.add(cb);
    return () => { alive = false; listeners.delete(cb); };
  }, []);
  return [city, loading];
}
