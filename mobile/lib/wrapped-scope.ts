// ============================================================================
// wrapped-scope.ts — the numbers the Wrapped card shows, all-time or weekly.
// ----------------------------------------------------------------------------
// Wrapped led with a single week, which is honest and, past a certain point,
// dispiriting: somebody thirty restaurants in opened it and saw "2 visits".
// The week is the interesting delta, but the accumulated history is the thing
// worth being shown first — it is what the app has actually built for you.
//
// Both scopes render through one component, so the share card cannot look like
// one thing and the tab like another.
// ============================================================================

import type { AnalyticsSummary } from "./analytics-stats";

export type WrappedStats = {
  /** Sits where the date range sits: "All time" or "Aug 31 – Sep 6". */
  rangeLabel: string;
  eyebrow: string;
  totalVisits: number;
  uniqueRestaurants: number;
  /** 0..1 — the share of visits that were returns rather than firsts. */
  repeatRate: number;
  topThree: { name: string; count: number }[];
};

/**
 * The share of visits that were RETURNS.
 *
 * Every restaurant contributes exactly one first visit, so everything beyond
 * that is a return: (visits - distinct places) / visits. Ten visits across ten
 * places is 0%; ten visits across three places is 70%. Returning is the signal
 * Palate is built on, which is why this number is on the card at all.
 */
export function repeatRate(totalVisits: number, uniqueRestaurants: number): number {
  if (totalVisits <= 0) return 0;
  const returns = Math.max(0, totalVisits - uniqueRestaurants);
  return returns / totalVisits;
}

export function allTimeStats(a: AnalyticsSummary): WrappedStats {
  return {
    rangeLabel: "All time",
    eyebrow: "YOUR PALATE SO FAR",
    totalVisits: a.totalVisits,
    uniqueRestaurants: a.uniqueRestaurants,
    repeatRate: repeatRate(a.totalVisits, a.uniqueRestaurants),
    topThree: a.topSpots.slice(0, 3).map((s) => ({ name: s.name, count: s.count })),
  };
}

/** Whether the week is worth a section of its own, or is just silence. */
export function weekIsWorthShowing(weekVisits: number | null | undefined): boolean {
  return (weekVisits ?? 0) > 0;
}
