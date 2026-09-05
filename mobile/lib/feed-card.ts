// ============================================================================
// feed-card.ts — the words on a visit card, kept pure so they can be tested.
// ----------------------------------------------------------------------------
// The feed used to be sentences: "Logged Ecco, an Italian spot in Midtown."
// A log line, with a heart under it. What Strava and Beli get right is that
// every post carries numbers and at least one of them is about the reader.
// These helpers produce those: their nth time, whether you have been, the
// meal, the day header, and the week's summary line.
// ============================================================================

export type FeedCardEvent = {
  id: string;
  kind: string;
  created_at: string;
  user_id: string;
  visitedAt?: string | null;
  mealType?: string | null;
  authorVisitOrdinal?: number | null;
  viewerVisitCount?: number | null;
  restaurant?: { google_place_id: string } | null;
};

/** Their nth time here. "First time" is a sentence; "4th visit" is a stat. */
export function ordinalLabel(n: number | null | undefined): string | null {
  if (n == null || n < 1) return null;
  if (n === 1) return "First time";
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th"
    : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix} visit`;
}

/** The reader's relationship to the place. The Strava move. */
export function youveBeenLabel(n: number | null | undefined, isSelf: boolean): string | null {
  if (n == null) return null;
  if (isSelf) return null; // the ordinal already says it
  if (n === 0) return "Never been";
  if (n === 1) return "You've been once";
  return `You've been ${n} times`;
}

const MEAL: Record<string, string> = {
  breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack",
};

/** "Dinner · Thu 7:40pm", or just the time when the meal is unknown. */
export function mealLine(mealType: string | null | undefined, visitedAt: string | null | undefined): string | null {
  if (!visitedAt) return null;
  const d = new Date(visitedAt);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString([], { weekday: "short" });
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const meal = mealType && MEAL[mealType];
  return meal ? `${meal} · ${day} ${time}` : `${day} ${time}`;
}

/** Old Instagram "Following" tab: activity under day headers. */
export function dayHeader(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "long", day: "numeric" });
}

export function groupFeedByDay<T extends { created_at: string }>(
  events: T[],
  now = new Date(),
): Array<{ title: string; data: T[] }> {
  const out: Array<{ title: string; data: T[] }> = [];
  for (const e of events) {
    const title = dayHeader(e.created_at, now);
    const last = out[out.length - 1];
    if (last && last.title === title) last.data.push(e);
    else out.push({ title, data: [e] });
  }
  return out;
}

/** The line above the feed: what the week looked like, from what is loaded. */
export function weekSummary(events: FeedCardEvent[], now = new Date()): string | null {
  const since = now.getTime() - 7 * 86_400_000;
  const visits = events.filter((e) => e.kind === "visit_logged" && new Date(e.created_at).getTime() >= since);
  if (visits.length === 0) return null;
  const people = new Set(visits.map((e) => e.user_id)).size;
  const places = new Set(visits.map((e) => e.restaurant?.google_place_id ?? e.id)).size;
  const v = visits.length === 1 ? "1 visit" : `${visits.length} visits`;
  const p = people === 1 ? "1 person" : `${people} people`;
  const pl = places === 1 ? "1 place" : `${places} places`;
  return `This week: ${v}, ${p}, ${pl}.`;
}
