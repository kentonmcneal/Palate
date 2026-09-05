import { supabase } from "./supabase";

export type Wrapped = {
  id: string;
  user_id: string;
  week_start: string;
  week_end: string;
  total_visits: number;
  unique_restaurants: number;
  top_restaurant: string | null;
  top_category: string | null;
  repeat_rate: number | null;
  personality_label: string | null;
  wrapped_json: {
    total_visits: number;
    unique_restaurants: number;
    top_restaurant: string | null;
    top_category: string | null;
    repeat_rate: number;
    personality_label: string;
    top_three: { name: string; count: number }[] | null;
  };
};

/** Returns the Monday of the ISO week containing `d`, in YYYY-MM-DD format. */
export function isoWeekStart(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7; // Sunday → 7
  if (day !== 1) date.setUTCDate(date.getUTCDate() - (day - 1));
  return date.toISOString().slice(0, 10);
}

export async function generateForCurrentWeek(): Promise<Wrapped | null> {
  const weekStart = isoWeekStart();
  const { data, error } = await supabase.rpc("generate_weekly_wrapped", {
    p_week_start: weekStart,
  });
  if (error) {
    if (error.message?.includes("No visits")) return null;
    throw error;
  }
  return data as Wrapped;
}

/**
 * Whether the stored Wrapped is worth regenerating before it is shown.
 *
 * The Sunday cron writes one row a week, and the tab only ever read the newest
 * stored row — so a week's worth of meals eaten after Sunday 14:00 UTC were
 * invisible until the NEXT Sunday. Someone with thirty restaurants saw a card
 * saying one visit and reasonably concluded it was broken.
 */
export function wrappedIsStale(
  storedWeekStart: string | null | undefined,
  thisWeekStart: string,
  storedVisits?: number | null,
  liveVisits?: number | null,
): boolean {
  if (storedWeekStart !== thisWeekStart) return true;
  // Same week, but the world moved on. The row is written once when it is
  // first asked for; every meal after that was invisible to the "This week"
  // card while the live analytics under it counted them, so the same screen
  // said 1 visit and 5 visits at once (founder's screenshot, 2026-09-05).
  if (storedVisits != null && liveVisits != null && liveVisits !== storedVisits) return true;
  return false;
}

/**
 * The current week's Wrapped, regenerated if what is stored is not this week.
 *
 * Regeneration is a single aggregate over your own visits, so doing it when the
 * tab opens is cheap and makes the card live rather than a Sunday snapshot. A
 * week with no visits generates nothing; the previous week is shown rather than
 * an empty tab, and the card carries its own date range so it never pretends to
 * be current.
 */
export async function currentWrapped(): Promise<Wrapped | null> {
  const stored = await latestWrapped();
  const weekStart = isoWeekStart();
  const live = await visitsSince(weekStart).catch(() => null);
  if (!wrappedIsStale(stored?.week_start, weekStart, stored?.total_visits, live)) return stored;
  const fresh = await generateForCurrentWeek().catch(() => null);
  return fresh ?? stored;
}

/** The reader's own visit count since a date. One cheap head query. */
async function visitsSince(isoDate: string): Promise<number | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { count, error } = await supabase
    .from("visits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("visited_at", `${isoDate}T00:00:00`);
  if (error) return null;
  return count ?? 0;
}

export async function latestWrapped(): Promise<Wrapped | null> {
  const { data, error } = await supabase
    .from("weekly_wrapped")
    .select("*")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as Wrapped | null;
}
