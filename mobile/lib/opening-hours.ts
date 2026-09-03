// ============================================================================
// opening-hours.ts — was this venue open at a given moment?
// ----------------------------------------------------------------------------
// Google returns `regularOpeningHours.periods`, which has three shapes that a
// naive implementation gets wrong:
//
//   1. A venue open 24 hours on a day has an `open` and NO `close`.
//   2. Periods cross midnight — open Friday 22:00, close Saturday 02:00 — so
//      comparing times within a single day fails for exactly the late dinners
//      we most want to attribute.
//   3. A period can wrap the week boundary (Saturday night into Sunday).
//
// Working in minutes-since-Sunday-midnight handles all three uniformly.
// ============================================================================

export type OpeningPeriod = {
  open?: { day?: number; hour?: number; minute?: number };
  /** Absent when the venue is open 24 hours from `open`. */
  close?: { day?: number; hour?: number; minute?: number };
};

const MINUTES_PER_WEEK = 7 * 24 * 60;

function toWeekMinutes(day: number, hour: number, minute: number): number {
  return day * 24 * 60 + hour * 60 + minute;
}

/**
 * Whether `at` falls inside any opening period.
 *
 * Returns null for "we don't know" — no data, or data we can't parse. Callers
 * must distinguish that from false: penalising a venue for missing hours would
 * punish exactly the small independent places this product exists to surface.
 *
 * Timezone caveat: Google reports hours in the VENUE's local time, while `at`
 * is the device's. Those agree whenever someone eats in the timezone they are
 * standing in, which is the overwhelmingly common case, and disagree while
 * travelling across zones on the same day.
 */
export function isOpenAt(periods: OpeningPeriod[] | null | undefined, at: Date): boolean | null {
  if (!Array.isArray(periods) || periods.length === 0) return null;

  const target = toWeekMinutes(at.getDay(), at.getHours(), at.getMinutes());
  let sawUsablePeriod = false;

  for (const p of periods) {
    const o = p.open;
    if (!o || typeof o.day !== "number" || typeof o.hour !== "number") continue;
    sawUsablePeriod = true;

    const start = toWeekMinutes(o.day, o.hour, o.minute ?? 0);

    // No close: open 24 hours from this point. Google emits a single such
    // period for an always-open venue.
    if (!p.close || typeof p.close.day !== "number" || typeof p.close.hour !== "number") {
      return true;
    }

    const end = toWeekMinutes(p.close.day, p.close.hour, p.close.minute ?? 0);

    if (end > start) {
      if (target >= start && target < end) return true;
    } else {
      // Wraps the week boundary — Saturday night into Sunday morning.
      if (target >= start || target < end) return true;
    }
  }

  return sawUsablePeriod ? false : null;
}

/** Convenience for a restaurant row carrying Google's raw periods. */
export function venueOpenAt(
  regularOpeningHours: unknown,
  at: Date,
): boolean | null {
  if (!Array.isArray(regularOpeningHours)) return null;
  return isOpenAt(regularOpeningHours as OpeningPeriod[], at);
}

export { MINUTES_PER_WEEK };
