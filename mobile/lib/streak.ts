import { supabase } from "./supabase";

// ============================================================================
// Daily streak tracking
// ----------------------------------------------------------------------------
// A "streak day" = any local-time day with at least one logged visit.
// The streak is unbroken as long as the user has either today's or
// yesterday's day filled in (yesterday lets us forgive a missed evening).
// ============================================================================

export type StreakInfo = {
  /** Current consecutive-day streak ending at the most recent logged day. */
  current: number;
  /** Longest consecutive-day streak in the user's history (within lookback window). */
  longest: number;
  /** Has the user logged at least one visit today (local time)? */
  loggedToday: boolean;
};

const LOOKBACK_DAYS = 120;

export async function computeStreak(): Promise<StreakInfo> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("visits")
    .select("visited_at")
    .gte("visited_at", since)
    .order("visited_at", { ascending: false });

  if (error) throw error;

  const dayKeys = new Set<string>();
  for (const row of (data ?? []) as Array<{ visited_at: string }>) {
    dayKeys.add(localDayKey(new Date(row.visited_at)));
  }

  const todayKey = localDayKey(new Date());
  const yesterdayKey = localDayKey(new Date(Date.now() - 86_400_000));
  const loggedToday = dayKeys.has(todayKey);

  // The streak's tail is today (if logged) or yesterday (forgiveness window).
  // If neither is filled in, the current streak is 0.
  let cursorMs: number | null = null;
  if (loggedToday) cursorMs = startOfLocalDay(new Date()).getTime();
  else if (dayKeys.has(yesterdayKey)) cursorMs = startOfLocalDay(new Date(Date.now() - 86_400_000)).getTime();

  let current = 0;
  if (cursorMs != null) {
    while (dayKeys.has(localDayKey(new Date(cursorMs)))) {
      current++;
      cursorMs -= 86_400_000;
    }
  }

  return {
    current,
    longest: Math.max(current, longestStreakIn(dayKeys)),
    loggedToday,
  };
}

// --- helpers --------------------------------------------------------------

function localDayKey(d: Date): string {
  // YYYY-MM-DD in the device's local timezone
  return d.toLocaleDateString("en-CA");
}

function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function longestStreakIn(dayKeys: Set<string>): number {
  if (!dayKeys.size) return 0;
  const sorted = [...dayKeys].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diff = curr.getTime() - prev.getTime();
    // ~1 day apart (allow a 1-hour timezone-edge fudge)
    if (diff > 23 * 3_600_000 && diff < 25 * 3_600_000) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }
  return longest;
}
