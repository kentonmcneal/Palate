// ============================================================================
// rec-funnel.ts — did a recommendation lead anywhere?
// ----------------------------------------------------------------------------
// Reads rec_funnel (migration 0136): admin-only, aggregates only. Per
// (surface, slot, rank): verified impressions, what was done with them, and
// visits within seven days at the place shown. The first four weeks are the
// baseline; nothing about the loop is judged before then.
// ============================================================================

import { supabase } from "./supabase";

export type RecFunnelRow = {
  surface: string;
  slot: string;
  rank: number;
  impressions: number;
  clicks: number;
  saves: number;
  maps: number;
  try_another: number;
  not_interested: number;
  visits_7d: number;
  distinct_places: number;
  distinct_users: number;
};

export async function loadRecFunnel(days = 28): Promise<RecFunnelRow[]> {
  const { data, error } = await supabase.rpc("rec_funnel", { p_days: days });
  if (error) throw error;
  return (data ?? []) as RecFunnelRow[];
}

/** One line per group, for a screen that has room for numbers, not charts. */
export function summarize(rows: RecFunnelRow[]): { surface: string; impressions: number; taken: number; visits: number; users: number }[] {
  const by = new Map<string, { surface: string; impressions: number; taken: number; visits: number; users: Set<number> }>();
  for (const r of rows) {
    const cur = by.get(r.surface) ?? { surface: r.surface, impressions: 0, taken: 0, visits: 0, users: new Set<number>() };
    cur.impressions += r.impressions;
    cur.taken += r.clicks + r.saves + r.maps;
    cur.visits += r.visits_7d;
    // distinct_users is per group; the max across groups is the honest floor.
    cur.users.add(r.distinct_users);
    by.set(r.surface, cur);
  }
  return [...by.values()]
    .map((c) => ({ surface: c.surface, impressions: c.impressions, taken: c.taken, visits: c.visits, users: Math.max(0, ...c.users) }))
    .sort((a, b) => b.impressions - a.impressions);
}

// ----------------------------------------------------------------------------
// History (migration 0140). rec_funnel aggregates raw events over a trailing
// window, and those rows prune. rec_funnel_weekly is the permanent record, so
// this is the only way to compare a week to the one before it once the raw
// events are gone.
// ----------------------------------------------------------------------------

export type RecFunnelWeek = RecFunnelRow & { week_start: string };

export async function loadRecFunnelHistory(weeks = 26): Promise<RecFunnelWeek[]> {
  const { data, error } = await supabase.rpc("rec_funnel_history", { p_weeks: weeks });
  if (error) throw error;
  return (data ?? []) as RecFunnelWeek[];
}

export type WeekTrend = {
  week: string;
  impressions: number;
  taken: number;
  visits: number;
  /** Taken per hundred impressions, or null when there is nothing to divide.
   *  Null rather than 0: "no data" and "nobody engaged" are different weeks. */
  takeRate: number | null;
};

/**
 * Newest first. One line per week, which is the only granularity worth showing
 * on a phone and the only one that survives the prune.
 *
 * A rate is withheld below MIN_IMPRESSIONS. Three impressions and one tap is
 * not a 33% take rate, it is noise wearing a percentage, and the founder's
 * rule against numbers that need a hedge applies to real arithmetic on tiny
 * denominators just as much as to invented figures.
 */
export const MIN_IMPRESSIONS_FOR_RATE = 30;

export function weeklyTrend(rows: RecFunnelWeek[]): WeekTrend[] {
  const by = new Map<string, WeekTrend>();
  for (const r of rows) {
    const cur = by.get(r.week_start)
      ?? { week: r.week_start, impressions: 0, taken: 0, visits: 0, takeRate: null };
    cur.impressions += r.impressions;
    cur.taken += r.clicks + r.saves + r.maps;
    cur.visits += r.visits_7d;
    by.set(r.week_start, cur);
  }
  return [...by.values()]
    .map((w) => ({
      ...w,
      takeRate: w.impressions >= MIN_IMPRESSIONS_FOR_RATE
        ? Math.round((w.taken / w.impressions) * 1000) / 10
        : null,
    }))
    .sort((a, b) => (a.week < b.week ? 1 : -1));
}

/** "8 Sep" — the week a line describes, not a full date nobody reads. */
export function weekLabel(week: string): string {
  const d = new Date(`${week}T00:00:00`);
  if (Number.isNaN(d.getTime())) return week;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
