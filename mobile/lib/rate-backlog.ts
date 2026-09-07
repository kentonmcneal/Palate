// ============================================================================
// rate-backlog.ts — the signal the app already earned and never asked for.
// ----------------------------------------------------------------------------
// Measured 2026-09-07: 55 visits, 2 of them rated. The ranker therefore knows
// where somebody went and almost nothing about whether it was any good.
//
// That is not a small gap. A rating feeds three maps in personal-signal.ts:
// the per-place sentiment the scorer reads directly, the per-restaurant map,
// and — the one that matters most — cuisine cross-learning, which is the only
// path by which liking one Vietnamese place can improve a recommendation for a
// Vietnamese place you have never been to. With two ratings all three are
// effectively empty, so the model generalises from visit COUNTS alone.
//
// One-tap rating at confirm time now catches new visits. This is for the
// backlog that predates it: fifty-three meals somebody actually ate, sitting
// in the database as unused signal.
//
// Deliberately not a streak, a nag, or a completion bar. It offers the oldest
// unrated visits a few at a time and disappears when there is nothing to ask.
// ============================================================================

import { supabase } from "./supabase";

export type UnratedVisit = {
  id: string;
  visitedAt: string;
  restaurantId: string;
  name: string;
  cuisine: string | null;
  googlePlaceId: string | null;
};

/** How many we hold in hand at once. Small: this is a card, not a chore. */
export const BACKLOG_BATCH = 12;

/**
 * Oldest first, on purpose. The most recent visits are the ones the confirm
 * flow already asked about, and a memory of a meal decays — if we are going to
 * spend somebody's willingness to answer, spend it where the answer is least
 * likely to still be recoverable tomorrow.
 */
export async function loadUnratedVisits(limit = BACKLOG_BATCH): Promise<UnratedVisit[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("visits")
    .select("id, visited_at, restaurant_id, restaurant:restaurants(name, cuisine_type, google_place_id)")
    .eq("user_id", user.id)
    .is("overall_rating", null)
    .order("visited_at", { ascending: true })
    .limit(limit);
  // A card that cannot load is not worth an error state on a profile.
  if (error || !data) return [];
  return (data as any[])
    .map(toUnrated)
    .filter((v): v is UnratedVisit => v !== null);
}

/** Shapes one PostgREST row. Exported for the tests: the embed comes back as
 *  an object or a one-element array depending on the join, and getting that
 *  wrong silently yields a card with no restaurant name. */
export function toUnrated(row: any): UnratedVisit | null {
  if (!row?.id) return null;
  const r = Array.isArray(row.restaurant) ? row.restaurant[0] : row.restaurant;
  const name = typeof r?.name === "string" ? r.name.trim() : "";
  // No name, no question. "How was ?" is not worth asking.
  if (!name) return null;
  return {
    id: String(row.id),
    visitedAt: String(row.visited_at),
    restaurantId: String(row.restaurant_id ?? ""),
    name,
    cuisine: r?.cuisine_type ?? null,
    googlePlaceId: r?.google_place_id ?? null,
  };
}

/**
 * "in March", "last Tuesday", "yesterday". The point is to help somebody
 * remember the meal, so recency is phrased the way a person would say it and
 * anything older than a fortnight gets a month rather than a day count.
 */
export function whenLabel(visitedAt: string, now: Date = new Date()): string {
  const then = new Date(visitedAt);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((startOfDay(now).getTime() - startOfDay(then).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  const sameYear = then.getFullYear() === now.getFullYear();
  const month = then.toLocaleDateString(undefined, { month: "long" });
  return sameYear ? `in ${month}` : `in ${month} ${then.getFullYear()}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * What the card says above the question. Never a count somebody has to clear:
 * "12 to go" turns a favour into a debt, and the founder's rule against
 * invented or pressuring numbers applies to real ones used that way too.
 */
export function backlogLine(remaining: number): string | null {
  if (remaining <= 1) return null;
  return "A few more when you have a minute";
}
