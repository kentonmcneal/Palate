// ============================================================================
// week-strip.ts — the week, in one line, on Home.
// ----------------------------------------------------------------------------
// Strava puts your week's numbers on the home screen, not three tabs away.
// The founder asked whether the "This week" card and the day bars belong on
// Home. The full cards stay on Wrapped, where they can be tapped into; Home
// gets the one-line version, tappable through to Wrapped: "This week: 5
// visits, 4 places. Friday was the big one."
// ============================================================================

import { isoWeekStart } from "./wrapped";

export type WeekStrip = { visits: number; places: number; busiest: string | null };

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekStrip(
  visits: Array<{ visited_at: string; restaurant_id?: string | null }>,
  now = new Date(),
): WeekStrip {
  const start = new Date(isoWeekStart(now) + "T00:00:00");
  const inWeek = visits.filter((v) => new Date(v.visited_at) >= start);
  const places = new Set(inWeek.map((v) => v.restaurant_id ?? v.visited_at)).size;
  const byDay = new Map<number, number>();
  for (const v of inWeek) {
    const d = new Date(v.visited_at).getDay();
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  let busiest: string | null = null;
  let best = 0;
  for (const [d, n] of byDay) {
    if (n > best) { best = n; busiest = DAY[d]; }
  }
  // A busiest day only means something when one day stood out.
  if (best < 2) busiest = null;
  return { visits: inWeek.length, places, busiest };
}

export function weekStripCopy(w: WeekStrip): string | null {
  if (w.visits === 0) return null;
  const v = w.visits === 1 ? "1 visit" : `${w.visits} visits`;
  const p = w.places === 1 ? "1 place" : `${w.places} places`;
  const tail = w.busiest ? ` ${w.busiest} was the big one.` : "";
  return `This week: ${v}, ${p}.${tail}`;
}
