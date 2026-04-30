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
