// ============================================================================
// analytics-stats.ts — all-time aggregations for the Insights screen.
// ----------------------------------------------------------------------------
// Pulls every confirmed visit, derives a RestaurantProfile per row, and
// returns a structured summary the Insights UI can render directly.
// All amounts in USD, all counts integers.
// ============================================================================

import { supabase } from "./supabase";
import {
  deriveRestaurantProfile,
  type RestaurantProfile,
  type RestaurantFormat,
  type BrandTier,
} from "./restaurant-profile";
import type { Restaurant } from "./places";

export type CuisineSlice  = { cuisine: string;  count: number; pct: number };
export type FormatSlice   = { format: RestaurantFormat; count: number; pct: number };
export type MealTimeSlice = { meal: "breakfast" | "lunch" | "dinner" | "snack"; count: number };
export type TopSpot       = { name: string; count: number; cuisine: string | null };

export type AnalyticsSummary = {
  totalVisits: number;
  uniqueRestaurants: number;
  /** Days from earliest visit to most recent. */
  spanDays: number;
  avgVisitsPerWeek: number;

  cuisineBreakdown: CuisineSlice[];
  formatBreakdown: FormatSlice[];
  mealTimeBreakdown: MealTimeSlice[];
  /** Sun=0 … Sat=6, count per day-of-week. */
  dayOfWeekCounts: number[];
  brandTierMix: Record<BrandTier, number>;

  topSpots: TopSpot[];

  /** Rough $ estimate based on price_level + format. */
  estimatedSpendAllTime: number;
  estimatedSpendPerWeek: number;
  estimatedSpendPerYear: number;

  /** 0..1 — uniqueRestaurants / totalVisits. 1 = no repeats; 0 = single spot. */
  varietyScore: number;
  /** % of visits at top single restaurant. */
  loyaltyScore: number;
};

// ----------------------------------------------------------------------------
// Heuristic dollar estimate per visit by price level + format.
// Quick-service value spots: ~$10. Fast casual: ~$15. Casual: ~$28. Fine: ~$80.
// ----------------------------------------------------------------------------

function estimatePerVisit(p: RestaurantProfile): number {
  const price = p.priceLevel ?? 2;
  const base: Record<RestaurantFormat, number> = {
    quick_service: 10,
    fast_casual: 15,
    casual_dining: 28,
    fine_dining: 80,
    cafe: 8,
    bar: 22,
  };
  const b = base[p.format] ?? 18;
  // Bump by price level (1=cheap, 4=$$$$). Adjust by ~30% per step from 2 baseline.
  const factor = 1 + (price - 2) * 0.30;
  return Math.max(5, b * factor);
}

// ----------------------------------------------------------------------------

type VisitRow = {
  visited_at: string;
  meal_type: string | null;
  restaurant: Restaurant | null;
};

export async function loadAllTimeAnalytics(): Promise<AnalyticsSummary> {
  const { data, error } = await supabase
    .from("visits")
    .select(`
      visited_at, meal_type,
      restaurant:restaurants (
        id, google_place_id, name, chain_name, primary_type,
        cuisine_type, neighborhood, tags, price_level, rating,
        address, latitude, longitude
      )
    `)
    .order("visited_at", { ascending: false });
  if (error) throw error;
  const visits = (data ?? []) as unknown as VisitRow[];

  return aggregate(visits);
}

// ----------------------------------------------------------------------------
// Pure aggregation — exported separately so it's easy to unit-test or feed
// fixture data without hitting Supabase.
// ----------------------------------------------------------------------------

export function aggregate(visits: VisitRow[]): AnalyticsSummary {
  const totalVisits = visits.length;

  if (totalVisits === 0) {
    return emptySummary();
  }

  const cuisineCounts = new Map<string, number>();
  const formatCounts = new Map<RestaurantFormat, number>();
  const mealCounts: Record<MealTimeSlice["meal"], number> = {
    breakfast: 0, lunch: 0, dinner: 0, snack: 0,
  };
  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  const tierCounts: Record<BrandTier, number> = {
    value: 0, mainstream: 0, premium_fast_casual: 0, upscale: 0, luxury: 0,
  };
  const restaurantCounts = new Map<string, { name: string; count: number; cuisine: string | null }>();

  let estTotal = 0;
  let earliestMs = Infinity;
  let latestMs = -Infinity;

  for (const v of visits) {
    if (!v.restaurant) continue;
    const profile = deriveRestaurantProfile(v.restaurant);
    const cuisine = profile.cuisineTypes[0] ?? "other";

    cuisineCounts.set(cuisine, (cuisineCounts.get(cuisine) ?? 0) + 1);
    formatCounts.set(profile.format, (formatCounts.get(profile.format) ?? 0) + 1);
    tierCounts[profile.brandTier]++;

    // Restaurant rollup
    const rkey = profile.name.toLowerCase();
    const existing = restaurantCounts.get(rkey);
    if (existing) existing.count++;
    else restaurantCounts.set(rkey, { name: profile.name, count: 1, cuisine });

    // Meal time
    const meal = (v.meal_type ?? "snack") as MealTimeSlice["meal"];
    if (meal in mealCounts) mealCounts[meal]++;

    // Day-of-week (local time)
    const d = new Date(v.visited_at);
    dowCounts[d.getDay()]++;

    // Span tracking
    const ms = d.getTime();
    if (ms < earliestMs) earliestMs = ms;
    if (ms > latestMs) latestMs = ms;

    estTotal += estimatePerVisit(profile);
  }

  const spanDays = Math.max(1, Math.round((latestMs - earliestMs) / 86_400_000) + 1);
  const avgVisitsPerWeek = (totalVisits / spanDays) * 7;
  const estimatedSpendPerWeek = (estTotal / spanDays) * 7;

  const cuisineBreakdown = sortedSlices(cuisineCounts, totalVisits);
  const formatBreakdown = sortedFormatSlices(formatCounts, totalVisits);
  const mealTimeBreakdown = (Object.entries(mealCounts) as Array<[MealTimeSlice["meal"], number]>)
    .map(([meal, count]) => ({ meal, count }));
  const topSpots = [...restaurantCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const uniqueRestaurants = restaurantCounts.size;
  const varietyScore = uniqueRestaurants / totalVisits;
  const loyaltyScore = topSpots.length > 0 ? topSpots[0].count / totalVisits : 0;

  return {
    totalVisits,
    uniqueRestaurants,
    spanDays,
    avgVisitsPerWeek,
    cuisineBreakdown,
    formatBreakdown,
    mealTimeBreakdown,
    dayOfWeekCounts: dowCounts,
    brandTierMix: tierCounts,
    topSpots,
    estimatedSpendAllTime: estTotal,
    estimatedSpendPerWeek,
    estimatedSpendPerYear: estimatedSpendPerWeek * 52,
    varietyScore,
    loyaltyScore,
  };
}

function sortedSlices(counts: Map<string, number>, total: number): CuisineSlice[] {
  const arr = [...counts.entries()].map(([cuisine, count]) => ({
    cuisine,
    count,
    pct: count / total,
  }));
  arr.sort((a, b) => b.count - a.count);
  // Collapse anything past top 6 into "Other"
  if (arr.length > 6) {
    const top = arr.slice(0, 6);
    const otherCount = arr.slice(6).reduce((s, x) => s + x.count, 0);
    if (otherCount > 0) {
      top.push({ cuisine: "other", count: otherCount, pct: otherCount / total });
    }
    return top;
  }
  return arr;
}

function sortedFormatSlices(counts: Map<RestaurantFormat, number>, total: number): FormatSlice[] {
  return [...counts.entries()]
    .map(([format, count]) => ({ format, count, pct: count / total }))
    .sort((a, b) => b.count - a.count);
}

function emptySummary(): AnalyticsSummary {
  return {
    totalVisits: 0,
    uniqueRestaurants: 0,
    spanDays: 0,
    avgVisitsPerWeek: 0,
    cuisineBreakdown: [],
    formatBreakdown: [],
    mealTimeBreakdown: [],
    dayOfWeekCounts: [0, 0, 0, 0, 0, 0, 0],
    brandTierMix: { value: 0, mainstream: 0, premium_fast_casual: 0, upscale: 0, luxury: 0 },
    topSpots: [],
    estimatedSpendAllTime: 0,
    estimatedSpendPerWeek: 0,
    estimatedSpendPerYear: 0,
    varietyScore: 0,
    loyaltyScore: 0,
  };
}
