// ============================================================================
// wrapped-tease.ts — Saturday evening: "your week, so far. Wrapped is in
// tomorrow."
// ----------------------------------------------------------------------------
// Spotify's trick is not the Wrapped, it is the week of knowing it is coming.
// This is one local notification, Saturday at 18:30, built from the real
// counts, and skipped outright when there is nothing to count: a tease with
// no numbers in it is the "we miss you" push in a different coat.
//
// Rescheduled from every Home load, so the copy reflects the week as of the
// last time the app was open. Never prompts for permission.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import { isoWeekStart } from "./wrapped";
import { cancelScheduledOfKind } from "./notification-dedupe";

const TEASE_ID_KEY = "palate.wrapped_tease.notif_id.v1";
export const TEASE_HOUR = 18;
export const TEASE_MINUTE = 30;

export type WeekSoFar = { visits: number; places: number };

/** Count the current ISO week from a list of visits. Pure. */
export function weekSoFar(
  visits: Array<{ visited_at: string; restaurant_id?: string | null }>,
  now = new Date(),
): WeekSoFar {
  const start = new Date(isoWeekStart(now) + "T00:00:00");
  const inWeek = visits.filter((v) => new Date(v.visited_at) >= start);
  const places = new Set(inWeek.map((v) => v.restaurant_id ?? v.visited_at));
  return { visits: inWeek.length, places: places.size };
}

/** The copy, or null when there is nothing worth saying. Pure. */
export function teaseCopy(w: WeekSoFar): { title: string; body: string } | null {
  if (w.visits === 0) return null;
  const v = w.visits === 1 ? "1 visit" : `${w.visits} visits`;
  const p = w.places === 1 ? "1 place" : `${w.places} places`;
  return {
    title: "Your week so far",
    body: `${v}, ${p}. Wrapped reads it back tomorrow.`,
  };
}

/** Next Saturday 18:30 local, or null if that is already behind us this week. */
export function teaseTimeFor(now = new Date()): Date | null {
  const d = new Date(now);
  const daysToSat = (6 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + daysToSat);
  d.setHours(TEASE_HOUR, TEASE_MINUTE, 0, 0);
  if (d.getTime() <= now.getTime() + 60_000) return null;
  return d;
}

export async function refreshWrappedTease(
  visits: Array<{ visited_at: string; restaurant_id?: string | null }>,
  now = new Date(),
): Promise<void> {
  let Notifications: typeof import("expo-notifications");
  try {
    Notifications = await import("expo-notifications");
  } catch {
    return;
  }
  const perm = await Notifications.getPermissionsAsync().catch(() => ({ granted: false }));
  if (!perm.granted) return;

  await cancelScheduledOfKind(Notifications, "type", "wrapped_tease");
  await AsyncStorage.removeItem(TEASE_ID_KEY).catch(() => {});

  const copy = teaseCopy(weekSoFar(visits, now));
  const when = teaseTimeFor(now);
  if (!copy || !when) return;

  const id = await Notifications.scheduleNotificationAsync({
    content: { title: copy.title, body: copy.body, data: { type: "wrapped_tease" } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
  });
  await AsyncStorage.setItem(TEASE_ID_KEY, id).catch(() => {});
}
