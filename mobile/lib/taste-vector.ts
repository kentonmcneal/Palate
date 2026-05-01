// ============================================================================
// taste-vector.ts — multi-dimensional aggregation of a user's eating signals.
// ----------------------------------------------------------------------------
// Reads visits + wishlist + restaurant tag schema (cuisine_region,
// cuisine_subregion, format_class, chain_type, occasion_tags, flavor_tags,
// cultural_context, etc.) and produces a normalized vector that the
// label-generator composes identities from.
//
// All inferences are from food behavior, restaurant metadata, and location
// patterns only. Never from protected-class attributes.
// ============================================================================

import { supabase } from "./supabase";

export type WeightMap = Record<string, number>;

export type TasteVector = {
  /** How many visits went into this vector. */
  visitCount: number;
  /** How many wishlist saves went into this vector. */
  wishlistCount: number;

  // Cuisine
  cuisineRegion: WeightMap;
  cuisineSubregion: WeightMap;
  cuisineRegionAspirational: WeightMap;
  cuisineSubregionAspirational: WeightMap;

  // Format / price / chain
  formatClass: WeightMap;
  priceTier: WeightMap;        // keys "1".."4"
  chainType: WeightMap;        // national_chain | regional_chain | local_chain | independent

  // Occasion / flavor / culture
  occasion: WeightMap;
  flavor: WeightMap;
  culturalContext: WeightMap;

  // Location
  topNeighborhoods: { name: string; weight: number }[];
  neighborhoodLoyalty: number;     // 0..1, share of visits in the top-1 hood
  geographicSpreadKm: number;      // max distance from centroid

  // Time patterns
  hourly: number[];                // 24-bin
  dowCounts: number[];             // 7-bin (Sun..Sat)
  weekendShare: number;            // 0..1, share of visits on Sat/Sun

  // Behavioral
  repeatRate: number;              // 0..1, share of visits to repeat restaurants
  explorationRate: number;         // 0..1, complement of repeatRate
  uniqueRestaurants: number;
  averagePriceLevel: number;       // 1..4
  priceSpread: number;             // 0..1, how varied the price tiers are (high = "high-low")

  // Aspirational signal
  aspirationalGap: number;         // 0..1, divergence between visits and wishlist cuisine mix
  aspirationTags: WeightMap;       // counts per aspiration tag
};

// ----------------------------------------------------------------------------
// Tunables
// ----------------------------------------------------------------------------
const RECENCY_HALF_LIFE_DAYS = 30;        // visits decay over a month
const WISHLIST_WEIGHT = 0.5;              // wishlist saves count half as much as visits
const MIN_TOP_NEIGHBORHOOD = 1;

// ----------------------------------------------------------------------------
// Public entry point
// ----------------------------------------------------------------------------
export async function computeTasteVector(opts?: { sinceDays?: number }): Promise<TasteVector> {
  const since = opts?.sinceDays
    ? new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString()
    : null;

  let visitsQ = supabase
    .from("visits")
    .select(`
      visited_at, meal_type,
      restaurant:restaurants (
        id, name, cuisine_type, cuisine_region, cuisine_subregion,
        format_class, chain_type, occasion_tags, flavor_tags,
        cultural_context, neighborhood, latitude, longitude, price_level
      )
    `)
    .order("visited_at", { ascending: false });
  if (since) visitsQ = visitsQ.gte("visited_at", since);

  const [{ data: visitsData, error: vErr }, { data: wishData, error: wErr }] = await Promise.all([
    visitsQ,
    supabase
      .from("wishlist")
      .select(`
        added_at, aspiration_tags,
        restaurant:restaurants (
          id, name, cuisine_type, cuisine_region, cuisine_subregion,
          format_class, neighborhood, price_level
        )
      `),
  ]);
  if (vErr) throw vErr;
  if (wErr) throw wErr;

  return aggregate(
    (visitsData ?? []) as unknown as VisitRow[],
    (wishData ?? []) as unknown as WishlistRow[],
  );
}

// ----------------------------------------------------------------------------
// Pure aggregation — exported for testability.
// ----------------------------------------------------------------------------
type RestaurantTags = {
  id?: string;
  name?: string;
  cuisine_type?: string | null;
  cuisine_region?: string | null;
  cuisine_subregion?: string | null;
  format_class?: string | null;
  chain_type?: string | null;
  occasion_tags?: string[] | null;
  flavor_tags?: string[] | null;
  cultural_context?: string | null;
  neighborhood?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  price_level?: number | null;
};

type VisitRow = {
  visited_at: string;
  meal_type: string | null;
  restaurant: RestaurantTags | null;
};

type WishlistRow = {
  added_at: string;
  aspiration_tags: string[] | null;
  restaurant: Pick<RestaurantTags, "id" | "name" | "cuisine_type" | "cuisine_region" | "cuisine_subregion" | "format_class" | "neighborhood" | "price_level"> | null;
};

export function aggregate(visits: VisitRow[], wishlist: WishlistRow[]): TasteVector {
  const v = emptyVector();
  v.visitCount = visits.length;
  v.wishlistCount = wishlist.length;

  // ---- visits ----
  const restaurantCounts = new Map<string, number>();
  const neighborhoodCounts = new Map<string, number>();
  const priceLevels: number[] = [];
  const points: Array<{ lat: number; lng: number }> = [];
  const now = Date.now();

  for (const visit of visits) {
    const r = unwrapRel(visit.restaurant);
    if (!r) continue;
    const w = recencyWeight(visit.visited_at, now);

    addWeight(v.cuisineRegion, r.cuisine_region, w);
    addWeight(v.cuisineSubregion, r.cuisine_subregion, w);
    addWeight(v.formatClass, r.format_class, w);
    addWeight(v.chainType, r.chain_type, w);
    if (r.price_level != null) {
      addWeight(v.priceTier, String(r.price_level), w);
      priceLevels.push(r.price_level);
    }
    for (const o of r.occasion_tags ?? []) addWeight(v.occasion, o, w);
    for (const f of r.flavor_tags ?? []) addWeight(v.flavor, f, w);
    addWeight(v.culturalContext, r.cultural_context, w);

    if (r.neighborhood) neighborhoodCounts.set(r.neighborhood, (neighborhoodCounts.get(r.neighborhood) ?? 0) + 1);

    const restaurantKey = r.id ?? r.name ?? "";
    if (restaurantKey) restaurantCounts.set(restaurantKey, (restaurantCounts.get(restaurantKey) ?? 0) + 1);

    const d = new Date(visit.visited_at);
    v.hourly[d.getHours()]++;
    v.dowCounts[d.getDay()]++;

    if (r.latitude != null && r.longitude != null) {
      points.push({ lat: r.latitude, lng: r.longitude });
    }
  }

  // ---- wishlist ----
  for (const wish of wishlist) {
    const r = unwrapRel(wish.restaurant);
    if (!r) continue;
    addWeight(v.cuisineRegionAspirational, r.cuisine_region, WISHLIST_WEIGHT);
    addWeight(v.cuisineSubregionAspirational, r.cuisine_subregion, WISHLIST_WEIGHT);
    for (const t of wish.aspiration_tags ?? []) addWeight(v.aspirationTags, t, 1);
  }

  // ---- top neighborhoods + loyalty ----
  v.topNeighborhoods = [...neighborhoodCounts.entries()]
    .map(([name, count]) => ({ name, weight: count }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);
  v.neighborhoodLoyalty = visits.length > 0 && v.topNeighborhoods.length >= MIN_TOP_NEIGHBORHOOD
    ? v.topNeighborhoods[0].weight / visits.length
    : 0;

  // ---- geographic spread (km) ----
  if (points.length > 0) {
    const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
    v.geographicSpreadKm = points.reduce(
      (max, p) => Math.max(max, haversineKm({ lat, lng }, p)),
      0,
    );
  }

  // ---- behavioral ----
  v.uniqueRestaurants = restaurantCounts.size;
  const repeatVisits = [...restaurantCounts.values()].filter((c) => c > 1).reduce((s, c) => s + c, 0);
  v.repeatRate = visits.length > 0 ? repeatVisits / visits.length : 0;
  v.explorationRate = 1 - v.repeatRate;

  v.averagePriceLevel = priceLevels.length > 0
    ? priceLevels.reduce((s, n) => s + n, 0) / priceLevels.length
    : 0;
  if (priceLevels.length >= 3) {
    const min = Math.min(...priceLevels);
    const max = Math.max(...priceLevels);
    v.priceSpread = (max - min) / 3; // normalized to 0..1 across the 1..4 scale
  }

  // ---- weekend share ----
  const weekend = v.dowCounts[0] + v.dowCounts[6];
  const total = v.dowCounts.reduce((s, c) => s + c, 0);
  v.weekendShare = total > 0 ? weekend / total : 0;

  // ---- aspirational gap (cuisine divergence between visits vs wishlist) ----
  v.aspirationalGap = jensenShannonLikeDivergence(
    normalize(v.cuisineRegion),
    normalize(v.cuisineRegionAspirational),
  );

  return v;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function emptyVector(): TasteVector {
  return {
    visitCount: 0,
    wishlistCount: 0,
    cuisineRegion: {},
    cuisineSubregion: {},
    cuisineRegionAspirational: {},
    cuisineSubregionAspirational: {},
    formatClass: {},
    priceTier: {},
    chainType: {},
    occasion: {},
    flavor: {},
    culturalContext: {},
    topNeighborhoods: [],
    neighborhoodLoyalty: 0,
    geographicSpreadKm: 0,
    hourly: new Array(24).fill(0),
    dowCounts: new Array(7).fill(0),
    weekendShare: 0,
    repeatRate: 0,
    explorationRate: 1,
    uniqueRestaurants: 0,
    averagePriceLevel: 0,
    priceSpread: 0,
    aspirationalGap: 0,
    aspirationTags: {},
  };
}

function addWeight(map: WeightMap, key: string | null | undefined, w: number) {
  if (!key) return;
  map[key] = (map[key] ?? 0) + w;
}

function unwrapRel<T>(rel: T | T[] | null | undefined): T | null {
  if (rel == null) return null;
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel;
}

function recencyWeight(iso: string, now: number): number {
  const ageDays = (now - new Date(iso).getTime()) / 86_400_000;
  // Half-life decay so recent visits matter more.
  return Math.pow(0.5, Math.max(0, ageDays) / RECENCY_HALF_LIFE_DAYS);
}

function normalize(map: WeightMap): WeightMap {
  const total = Object.values(map).reduce((s, n) => s + n, 0);
  if (total === 0) return {};
  const out: WeightMap = {};
  for (const [k, v] of Object.entries(map)) out[k] = v / total;
  return out;
}

/**
 * Cheap divergence proxy in [0..1]: 1 = totally different, 0 = identical.
 * Sums abs differences across union of keys, divided by 2.
 */
function jensenShannonLikeDivergence(a: WeightMap, b: WeightMap): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  if (keys.size === 0) return 0;
  let sum = 0;
  for (const k of keys) sum += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
  return Math.min(1, sum / 2);
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ----------------------------------------------------------------------------
// Top-K helpers — used by the label generator
// ----------------------------------------------------------------------------
export function topKey(map: WeightMap): string | null {
  const entries = Object.entries(map);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

export function topShare(map: WeightMap): number {
  const total = Object.values(map).reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  const max = Math.max(...Object.values(map));
  return max / total;
}

export function topN(map: WeightMap, n: number): { key: string; weight: number; share: number }[] {
  const total = Object.values(map).reduce((s, x) => s + x, 0) || 1;
  return Object.entries(map)
    .map(([key, weight]) => ({ key, weight, share: weight / total }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n);
}
