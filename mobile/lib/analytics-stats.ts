// ============================================================================
// analytics-stats.ts — bounded-range aggregations for the Insights screen.
// ----------------------------------------------------------------------------
// loadAnalytics(range) accepts week / month / quarter / year / all and
// returns the same AnalyticsSummary shape. Per-week and per-year estimates
// normalize against the range's calendar window (not the actual visit span),
// so projections stay sensible even when there are zero visits in the period.
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

export type TimeRange = "week" | "month" | "quarter" | "year" | "all";

export type CuisineSlice  = { cuisine: string;  count: number; pct: number };
export type FormatSlice   = { format: RestaurantFormat; count: number; pct: number };
export type MealTimeSlice = { meal: "breakfast" | "lunch" | "dinner" | "snack"; count: number };
export type TopSpot       = { name: string; count: number; cuisine: string | null };

export type HourlyPattern =
  | "late_night"        // ≥30% of visits after 9pm
  | "early_riser"       // ≥30% before 9am
  | "tight_window"      // 80%+ of visits within a 4-hour window
  | "irregular"         // visits spread across >8 distinct hours
  | "midday_anchor"     // strong 12–2pm cluster
  | "evening_anchor";   // strong 6–8pm cluster

export type HourlyInsight = {
  pattern: HourlyPattern;
  /** Plain-English copy for the insight card. */
  text: string;
};

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
  /** 24-bin count of visits, indexed by hour-of-day (0..23). */
  hourlyCounts: number[];
  /** Plain-English insights derived from the hourly distribution. */
  hourlyInsights: HourlyInsight[];
  brandTierMix: Record<BrandTier, number>;

  topSpots: TopSpot[];

  /** 0..1 — uniqueRestaurants / totalVisits. 1 = no repeats; 0 = single spot. */
  varietyScore: number;
  /** % of visits at top single restaurant. */
  loyaltyScore: number;
};

// ----------------------------------------------------------------------------
// Time-range bounds — calendar-anchored (Monday for week, 1st for month, etc).
// Returns the cutoff date for the query AND the elapsed days in the window
// (used to normalize per-week / per-year estimates so projections still make
// sense partway through a window).
// ----------------------------------------------------------------------------

export function dateBoundsFor(range: TimeRange, now = new Date()): { since: Date | null; windowDays: number } {
  if (range === "all") return { since: null, windowDays: 365 }; // windowDays ignored for "all"

  const since = new Date(now);
  if (range === "week") {
    // Monday of this week
    const dow = since.getDay() || 7; // Sunday => 7
    since.setDate(since.getDate() - (dow - 1));
    since.setHours(0, 0, 0, 0);
  } else if (range === "month") {
    since.setDate(1);
    since.setHours(0, 0, 0, 0);
  } else if (range === "quarter") {
    const m = now.getMonth();
    const qStart = m - (m % 3);
    since.setMonth(qStart, 1);
    since.setHours(0, 0, 0, 0);
  } else if (range === "year") {
    since.setMonth(0, 1);
    since.setHours(0, 0, 0, 0);
  }

  const windowDays = Math.max(1, Math.floor((now.getTime() - since.getTime()) / 86_400_000) + 1);
  return { since, windowDays };
}

type VisitRow = {
  visited_at: string;
  meal_type: string | null;
  restaurant: Restaurant | null;
};

export async function loadAnalytics(range: TimeRange = "all"): Promise<AnalyticsSummary> {
  const { since, windowDays } = dateBoundsFor(range);

  let query = supabase
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

  if (since) query = query.gte("visited_at", since.toISOString());

  const { data, error } = await query;
  if (error) throw error;
  const visits = (data ?? []) as unknown as VisitRow[];

  // For bounded ranges, use the window length so per-week / per-year
  // projections stay sensible (don't compress to a single day if there's
  // only one visit early in the period).
  return aggregate(visits, range === "all" ? undefined : { windowDays });
}

/** @deprecated use loadAnalytics(range) */
export const loadAllTimeAnalytics = () => loadAnalytics("all");

// ----------------------------------------------------------------------------
// Pure aggregation — exported separately so it's easy to unit-test or feed
// fixture data without hitting Supabase.
// ----------------------------------------------------------------------------

export function aggregate(
  visits: VisitRow[],
  options?: { windowDays?: number },
): AnalyticsSummary {
  const totalVisits = visits.length;

  if (totalVisits === 0) {
    // Even with no visits, we want windowDays to reflect the chosen range
    // so the empty UI shows e.g. "7 days · 0 visits" not "0 days · 0 visits".
    return { ...emptySummary(), spanDays: options?.windowDays ?? 0 };
  }

  const cuisineCounts = new Map<string, number>();
  const formatCounts = new Map<RestaurantFormat, number>();
  const mealCounts: Record<MealTimeSlice["meal"], number> = {
    breakfast: 0, lunch: 0, dinner: 0, snack: 0,
  };
  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  const hourlyCounts = new Array<number>(24).fill(0);
  const tierCounts: Record<BrandTier, number> = {
    value: 0, mainstream: 0, premium_fast_casual: 0, upscale: 0, luxury: 0,
  };
  const restaurantCounts = new Map<string, { name: string; count: number; cuisine: string | null }>();

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

    // Day-of-week + hour-of-day (local time)
    const d = new Date(v.visited_at);
    dowCounts[d.getDay()]++;
    hourlyCounts[d.getHours()]++;

    // Span tracking
    const ms = d.getTime();
    if (ms < earliestMs) earliestMs = ms;
    if (ms > latestMs) latestMs = ms;
  }

  const naturalSpan = Math.max(1, Math.round((latestMs - earliestMs) / 86_400_000) + 1);
  const spanDays = options?.windowDays ?? naturalSpan;
  const avgVisitsPerWeek = (totalVisits / spanDays) * 7;

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

  const hourlyInsights = deriveHourlyInsights(hourlyCounts, totalVisits);

  return {
    totalVisits,
    uniqueRestaurants,
    spanDays,
    avgVisitsPerWeek,
    cuisineBreakdown,
    formatBreakdown,
    mealTimeBreakdown,
    dayOfWeekCounts: dowCounts,
    hourlyCounts,
    hourlyInsights,
    brandTierMix: tierCounts,
    topSpots,
    varietyScore,
    loyaltyScore,
  };
}

// ----------------------------------------------------------------------------
// Hourly pattern detection — turns the 24-bin histogram into 1–3 plain-English
// insights. Tone is observational ("you tend to…"), not judgmental.
// ----------------------------------------------------------------------------
function deriveHourlyInsights(hours: number[], total: number): HourlyInsight[] {
  if (total < 3) return []; // need at least 3 visits to read a pattern

  const out: HourlyInsight[] = [];

  // Late night: ≥30% of visits at 9pm or later
  const lateNight = sumRange(hours, 21, 23) + sumRange(hours, 0, 2);
  if (lateNight / total >= 0.3) {
    out.push({
      pattern: "late_night",
      text: "A meaningful slice of your eating happens late at night.",
    });
  }

  // Early morning: ≥30% before 9am
  const earlyMorning = sumRange(hours, 5, 8);
  if (earlyMorning / total >= 0.3) {
    out.push({
      pattern: "early_riser",
      text: "You tend to eat earlier than most — before 9am shows up a lot.",
    });
  }

  // Tight window: 80% inside any rolling 4-hour band
  const tight = findTightWindow(hours, total, 4, 0.8);
  if (tight) {
    out.push({
      pattern: "tight_window",
      text: `Your eating clusters tightly between ${formatHour(tight.start)} and ${formatHour((tight.start + 4) % 24)}.`,
    });
  }

  // Midday anchor: 12–2pm holds ≥35% of visits
  const midday = sumRange(hours, 12, 14);
  if (midday / total >= 0.35) {
    out.push({
      pattern: "midday_anchor",
      text: `You mostly eat between ${formatHour(12)} and ${formatHour(14)}.`,
    });
  }

  // Evening anchor: 6–8pm holds ≥35%
  const evening = sumRange(hours, 18, 20);
  if (evening / total >= 0.35) {
    out.push({
      pattern: "evening_anchor",
      text: `You have a strong ${formatHour(18)} routine.`,
    });
  }

  // Irregular: visits spread across many hours and no other pattern fired
  const distinctHours = hours.filter((c) => c > 0).length;
  if (out.length === 0 && distinctHours >= 8) {
    out.push({
      pattern: "irregular",
      text: "Your eating times are pretty spread out — no single hour dominates.",
    });
  }

  // Cap at 3 to keep the insight card scannable
  return out.slice(0, 3);
}

function sumRange(hours: number[], startHour: number, endHour: number): number {
  let s = 0;
  for (let h = startHour; h <= endHour; h++) s += hours[h] ?? 0;
  return s;
}

/** Smallest n-hour window containing pct% of all visits. Returns null if none. */
function findTightWindow(
  hours: number[],
  total: number,
  windowSize: number,
  pctThreshold: number,
): { start: number; pct: number } | null {
  let best: { start: number; pct: number } | null = null;
  for (let start = 0; start < 24; start++) {
    let sum = 0;
    for (let i = 0; i < windowSize; i++) sum += hours[(start + i) % 24];
    const pct = sum / total;
    if (pct >= pctThreshold && (!best || pct > best.pct)) {
      best = { start, pct };
    }
  }
  return best;
}

/** "12pm", "9am", "12am" — short labels for axis + insight text. */
export function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
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
    hourlyCounts: new Array(24).fill(0),
    hourlyInsights: [],
    brandTierMix: { value: 0, mainstream: 0, premium_fast_casual: 0, upscale: 0, luxury: 0 },
    topSpots: [],
    varietyScore: 0,
    loyaltyScore: 0,
  };
}
