// ============================================================================
// aspirational-palate.ts
// ----------------------------------------------------------------------------
// Compares where the user actually eats (visits) vs where they save / want to
// try (wishlist). The gap between the two is "Aspirational Palate" — the
// identity they're aiming at, separate from the one their behavior reveals.
//
// Output is a single insight string + structured data so the Insights screen
// can render breakdowns side-by-side.
// ============================================================================

import { supabase } from "./supabase";
import { listWishlist } from "./palate-insights";
import { loadAnalytics, type AnalyticsSummary } from "./analytics-stats";

type Counter = Record<string, number>;

export type AspirationalPalate = {
  /** "Your current Palate is X. Your Aspirational Palate leans Y." */
  insight: string;
  /** True if the wishlist is meaningfully different from the visit pattern. */
  hasGap: boolean;
  /** Top cuisines in the actual visit pattern. */
  actualCuisines: { cuisine: string; pct: number }[];
  /** Top cuisines in the wishlist. */
  aspirationalCuisines: { cuisine: string; pct: number }[];
  /** Most common aspiration tags on saved spots. */
  topAspirationTags: { tag: string; count: number }[];
  /** Avg price level of actual visits vs wishlist (1-4 scale). */
  actualPriceLevel: number | null;
  aspirationalPriceLevel: number | null;
  /** Neighborhoods saved but not visited. */
  aspirationalNeighborhoods: string[];
};

export async function computeAspirationalPalate(): Promise<AspirationalPalate | null> {
  const [actual, wishlist, visitedNeighborhoods] = await Promise.all([
    loadAnalytics("all"),
    listWishlist(),
    fetchVisitedNeighborhoods(),
  ]);

  const wishRestaurants = wishlist
    .map((w) => w.restaurant)
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (wishRestaurants.length === 0) return null;

  // ---- cuisines ----
  const actualCuisines = actual.cuisineBreakdown
    .slice(0, 3)
    .map((s) => ({ cuisine: s.cuisine, pct: s.pct }));

  const wishCuisineCounts: Counter = {};
  for (const r of wishRestaurants) {
    const c = r.cuisine_type ?? "other";
    wishCuisineCounts[c] = (wishCuisineCounts[c] ?? 0) + 1;
  }
  const wishTotal = wishRestaurants.length;
  const aspirationalCuisines = Object.entries(wishCuisineCounts)
    .map(([cuisine, count]) => ({ cuisine, pct: count / wishTotal }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);

  // ---- aspiration tags ----
  const tagCounts: Counter = {};
  for (const w of wishlist) {
    for (const t of w.aspiration_tags ?? []) {
      tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    }
  }
  const topAspirationTags = Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  // ---- price level ----
  const actualPriceLevel = avgPriceLevel(actual);
  const aspirationalPriceLevel = wishRestaurants.length
    ? avg(wishRestaurants.map((r) => r.price_level).filter((p): p is number => p != null))
    : null;

  // ---- neighborhoods (saved but not visited) ----
  const aspirationalNeighborhoods = unique(
    wishRestaurants
      .map((r) => r.neighborhood)
      .filter((n): n is string => !!n && !visitedNeighborhoods.has(n)),
  ).slice(0, 5);

  // ---- insight string ----
  const insight = buildInsightString({
    actualCuisines,
    aspirationalCuisines,
    topAspirationTags,
    actualPriceLevel,
    aspirationalPriceLevel,
    aspirationalNeighborhoods,
    hasVisits: actual.totalVisits > 0,
  });

  const hasGap = topAspirationTags.length > 0 ||
    aspirationalNeighborhoods.length > 0 ||
    cuisineMixDiverges(actualCuisines, aspirationalCuisines);

  return {
    insight,
    hasGap,
    actualCuisines,
    aspirationalCuisines,
    topAspirationTags,
    actualPriceLevel,
    aspirationalPriceLevel,
    aspirationalNeighborhoods,
  };
}

// ----------------------------------------------------------------------------

function buildInsightString(args: {
  actualCuisines: { cuisine: string; pct: number }[];
  aspirationalCuisines: { cuisine: string; pct: number }[];
  topAspirationTags: { tag: string; count: number }[];
  actualPriceLevel: number | null;
  aspirationalPriceLevel: number | null;
  aspirationalNeighborhoods: string[];
  hasVisits: boolean;
}): string {
  const actualLabel = args.hasVisits
    ? describeCuisineMix(args.actualCuisines)
    : "still forming";
  const aspirationalLabel = args.topAspirationTags.length > 0
    ? describeTags(args.topAspirationTags)
    : describeCuisineMix(args.aspirationalCuisines);

  const priceShift =
    args.actualPriceLevel != null && args.aspirationalPriceLevel != null
      ? args.aspirationalPriceLevel - args.actualPriceLevel
      : 0;

  const priceHint =
    priceShift >= 0.7  ? " — and a step more upscale" :
    priceShift <= -0.7 ? " — and a touch more casual" :
    "";

  return `Your current Palate is ${actualLabel}. Your Aspirational Palate leans ${aspirationalLabel}${priceHint}.`;
}

function describeCuisineMix(cs: { cuisine: string; pct: number }[]): string {
  if (cs.length === 0) return "still forming";
  const top = cs[0];
  if (top.pct >= 0.5) return `${prettyCuisine(top.cuisine)}-heavy`;
  if (cs.length === 1) return `mostly ${prettyCuisine(top.cuisine)}`;
  return `${prettyCuisine(cs[0].cuisine)} + ${prettyCuisine(cs[1].cuisine)}`;
}

function describeTags(ts: { tag: string; count: number }[]): string {
  const labels = ts.slice(0, 2).map((t) => prettyTag(t.tag));
  if (labels.length === 1) return labels[0];
  return `${labels[0]} + ${labels[1]}`;
}

function prettyCuisine(c: string): string {
  if (c === "café") return "café";
  return c.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function prettyTag(t: string): string {
  return t.replace(/_/g, " ");
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

// Cuisine mix diverges if top actual cuisine isn't in top 2 of aspirational
// (or vice versa). Quick heuristic — good enough for the "hasGap" boolean.
function cuisineMixDiverges(
  a: { cuisine: string }[],
  b: { cuisine: string }[],
): boolean {
  if (a.length === 0 || b.length === 0) return b.length > 0;
  const aTop = a[0].cuisine;
  const bTop2 = new Set(b.slice(0, 2).map((x) => x.cuisine));
  return !bTop2.has(aTop);
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ----------------------------------------------------------------------------
// Bridge helpers — borrow neighborhood/price aggregation from analytics-stats
// without re-loading visits.
// ----------------------------------------------------------------------------

function avgPriceLevel(_summary: AnalyticsSummary): number | null {
  // analytics-stats doesn't expose raw price levels; the brandTier mix is the
  // best proxy. value=1, mainstream=2, premium_fast_casual=3, upscale=4, luxury=5.
  // We collapse it into an approximate 1–4 score for cross-comparison.
  const mix = _summary.brandTierMix;
  const total = mix.value + mix.mainstream + mix.premium_fast_casual + mix.upscale + mix.luxury;
  if (total === 0) return null;
  const weighted =
    mix.value * 1 +
    mix.mainstream * 2 +
    mix.premium_fast_casual * 3 +
    mix.upscale * 4 +
    mix.luxury * 4;
  return weighted / total;
}

/** Returns a Set of neighborhood strings the user has actually visited. */
async function fetchVisitedNeighborhoods(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("visits")
    .select("restaurant:restaurants(neighborhood)");
  if (error) return new Set();
  const set = new Set<string>();
  // The supabase JS client returns joined relations as either an object or an
  // array depending on FK cardinality — coerce safely.
  for (const row of (data ?? []) as unknown as Array<{ restaurant: any }>) {
    const r = Array.isArray(row.restaurant) ? row.restaurant[0] : row.restaurant;
    if (r?.neighborhood) set.add(r.neighborhood as string);
  }
  return set;
}
