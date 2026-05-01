// ============================================================================
// location-analytics.ts
// ----------------------------------------------------------------------------
// Geo-aware analytics computed from raw visits + the wishlist:
//   - mostVisitedNeighborhoods
//   - eatingRadiusKm  (max distance from centroid of all visits)
//   - newNeighborhoods  (visited recently but not in the prior month)
//   - aspirationalNeighborhoods  (saved but never visited)
//   - homeWorkAnchors  (top two neighborhoods by frequency, as a stand-in for
//     home/work clusters; real geo-clustering can come later)
//
// All distance math is done in plain JS — no external geo libs.
// ============================================================================

import { supabase } from "./supabase";
import { listWishlist } from "./palate-insights";

export type NeighborhoodCount = { neighborhood: string; count: number; pct: number };

export type LocationPatternSummary = {
  totalVisits: number;
  mostVisitedNeighborhoods: NeighborhoodCount[];
  /** Two top-frequency neighborhoods — "home/work-like" anchors. */
  homeWorkAnchors: NeighborhoodCount[];
  /** Max distance (km) any visit was from the centroid of all visits. */
  eatingRadiusKm: number | null;
  /** Centroid of the visit cloud (lat/lng). */
  centroid: { lat: number; lng: number } | null;
  /** Neighborhoods first visited in the last 30 days. */
  newNeighborhoods: string[];
  /** Neighborhoods saved on the wishlist but not yet visited. */
  aspirationalNeighborhoods: string[];
};

type VisitGeoRow = {
  visited_at: string;
  restaurant: {
    neighborhood: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
};

export async function computeLocationPatterns(): Promise<LocationPatternSummary> {
  const [{ data: visits, error }, wishlist] = await Promise.all([
    supabase
      .from("visits")
      .select(`
        visited_at,
        restaurant:restaurants ( neighborhood, latitude, longitude )
      `)
      .order("visited_at", { ascending: true }),
    listWishlist(),
  ]);
  if (error) throw error;

  const rows = (visits ?? []) as unknown as VisitGeoRow[];
  return aggregate(rows, wishlist);
}

export function aggregate(
  visits: VisitGeoRow[],
  wishlist: Awaited<ReturnType<typeof listWishlist>>,
): LocationPatternSummary {
  const totalVisits = visits.length;

  // ---- neighborhood counts ----
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, Date>();
  for (const v of visits) {
    const n = v.restaurant?.neighborhood;
    if (!n) continue;
    counts.set(n, (counts.get(n) ?? 0) + 1);
    if (!firstSeen.has(n)) firstSeen.set(n, new Date(v.visited_at));
  }

  const mostVisitedNeighborhoods: NeighborhoodCount[] = [...counts.entries()]
    .map(([neighborhood, count]) => ({
      neighborhood,
      count,
      pct: totalVisits > 0 ? count / totalVisits : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const homeWorkAnchors = mostVisitedNeighborhoods.slice(0, 2);

  // ---- centroid + radius (km) ----
  const points = visits
    .map((v) => v.restaurant)
    .filter((r): r is NonNullable<typeof r> => !!r && r.latitude != null && r.longitude != null)
    .map((r) => ({ lat: r.latitude as number, lng: r.longitude as number }));

  let centroid: { lat: number; lng: number } | null = null;
  let eatingRadiusKm: number | null = null;
  if (points.length > 0) {
    const sumLat = points.reduce((s, p) => s + p.lat, 0);
    const sumLng = points.reduce((s, p) => s + p.lng, 0);
    centroid = { lat: sumLat / points.length, lng: sumLng / points.length };
    eatingRadiusKm = points.reduce(
      (max, p) => Math.max(max, haversineKm(centroid!, p)),
      0,
    );
  }

  // ---- new neighborhoods (first seen in last 30 days) ----
  const cutoff = Date.now() - 30 * 86_400_000;
  const newNeighborhoods = [...firstSeen.entries()]
    .filter(([, d]) => d.getTime() >= cutoff)
    .sort((a, b) => b[1].getTime() - a[1].getTime())
    .map(([n]) => n);

  // ---- aspirational (wishlist-only) ----
  const visitedSet = new Set(counts.keys());
  const aspirationalNeighborhoods = uniq(
    wishlist
      .map((w) => w.restaurant?.neighborhood)
      .filter((n): n is string => !!n && !visitedSet.has(n)),
  ).slice(0, 8);

  return {
    totalVisits,
    mostVisitedNeighborhoods,
    homeWorkAnchors,
    eatingRadiusKm,
    centroid,
    newNeighborhoods,
    aspirationalNeighborhoods,
  };
}

// ----------------------------------------------------------------------------
// Haversine formula — distance (km) between two lat/lng points.
// ----------------------------------------------------------------------------
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
