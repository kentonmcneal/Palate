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
