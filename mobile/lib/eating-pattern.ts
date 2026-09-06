// ============================================================================
// eating-pattern.ts: when THIS person eats.
// ----------------------------------------------------------------------------
// The founder's question, verbatim: "are we tracking that data? Would we get
// to start to gather people's patterns and every eat times so we can tailor
// passive tracking to them and their patterns". The data was already being
// recorded (every visit carries an hour and a weekday, and the taste vector
// folds them into 24- and 7-bin histograms) and nothing read it back. This is
// the read-back.
//
// Two consumers. The confidence scorer asks "does a stop at this hour look
// like a meal for this person?", and the digest scheduler asks "by what hour
// is this person usually done eating?". Both run from background wakes with
// no network, so the pattern lives in AsyncStorage and is refreshed as a side
// effect of the taste vector being computed, which the app does constantly.
//
// Pure functions first, storage last. Everything here is defensive about
// sample size: five visits is not a pattern, and a pattern built from twenty
// visits is trusted less than one built from two hundred. One histogram for
// all seven days for now; the weekday parameters are kept in the signatures
// so a weekday/weekend split can land without touching the callers.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";

export type EatingPattern = {
  /** Smoothed visits per clock hour, 24 bins. Neighbours share weight, so the
   *  array sums to more than `total`; only the ratios between hours matter. */
  hours: number[];
  /** Raw visits per weekday, 7 bins in JS getDay() order (0 = Sunday). */
  dows: number[];
  /** Raw visit count behind the histogram. This is the trust knob. */
  total: number;
  updatedAt: number;
};

export const EATING_PATTERN_KEY = "palate.eatingPattern";

/** Below this many visits the pattern says nothing about any single hour. */
export const MIN_VISITS_FOR_FIT = 5;
/** Below this many visits the digest keeps the weekday default. */
export const MIN_VISITS_FOR_DIGEST = 10;
/** Visit count at which the pattern is trusted halfway: trust = total / (total + this). */
export const TRUST_HALF_POINT = 10;
/** The share of a person's eating that must be behind them for the day to count as done. */
export const DONE_EATING_SHARE = 0.85;
/**
 * The clock hour a person's eating day starts. A 1am stop is the end of the
 * previous night, not the start of the next day, so cumulative sums walk the
 * day from here and wrap past midnight.
 */
export const EATING_DAY_START = 4;
export const DIGEST_EARLIEST_HOUR = 20;
export const DIGEST_LATEST_HOUR = 23;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function clockHour(hour: number): number {
  return ((Math.floor(hour) % 24) + 24) % 24;
}

/**
 * Each hour keeps its own visits and receives half of each neighbour's. One
 * 19:00 visit therefore also lends weight to 18:00 and 20:00, which is what
 * we mean: a person who ate at seven would plausibly eat at six or eight,
 * and a single visit should not make the hour either side look alien.
 * Circular at midnight, because 23:00 and 00:00 are neighbours too.
 */
export function smoothHours(hourly: number[]): number[] {
  const out: number[] = new Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    const raw = Number.isFinite(hourly[h]) ? Math.max(0, hourly[h]) : 0;
    if (!raw) continue;
    out[h] += raw;
    out[(h + 23) % 24] += raw * 0.5;
    out[(h + 1) % 24] += raw * 0.5;
  }
  return out;
}

export function buildEatingPattern(
  hourly: number[],
  dowCounts: number[],
  now = Date.now(),
): EatingPattern {
  const total = hourly.reduce(
    (s, n) => s + (Number.isFinite(n) ? Math.max(0, n) : 0),
    0,
  );
  return {
    hours: smoothHours(hourly),
    dows: Array.from({ length: 7 }, (_, d) => (Number.isFinite(dowCounts[d]) ? Math.max(0, dowCounts[d]) : 0)),
    total,
    updatedAt: now,
  };
}

/**
 * How much a stop at `hour` looks like a meal for this person, 0..1, or null
 * when we cannot say.
 *
 * The person's own busiest hour scores 1 and an hour they have never eaten at
 * scores 0, so the result is relative to them rather than to a population.
 * That ratio is then shrunk toward 0.5 ("no opinion") by how much history
 * stands behind it: at five visits the peak reads 0.67, at a hundred it reads
 * 0.95. Nothing about a thin histogram should be allowed to overrule the
 * generic meal window.
 *
 * `dow` is accepted and ignored. With one histogram there is nothing to pick
 * by weekday yet; the parameter exists so the split can arrive without
 * changing the confidence scorer's call.
 */
export function patternFit(p: EatingPattern | null, hour: number, dow: number): number | null {
  void dow;
  if (!p || p.total < MIN_VISITS_FOR_FIT) return null;
  const peak = Math.max(0, ...p.hours);
  if (!(peak > 0)) return null;
  const ratio = clamp01((p.hours[clockHour(hour)] ?? 0) / peak);
  const trust = p.total / (p.total + TRUST_HALF_POINT);
  return clamp01(0.5 + (ratio - 0.5) * trust);
}

/**
 * The clock hour by which 85% of this person's eating has happened, walking
 * the day from EATING_DAY_START so a post-midnight visit counts as late, not
 * early. Null when there is no histogram at all.
 *
 * `weekendNight` is accepted and ignored for the same reason `dow` is above.
 */
export function usualLastMealHour(p: EatingPattern | null, weekendNight: boolean): number | null {
  void weekendNight;
  if (!p) return null;
  const sum = p.hours.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
  if (!(sum > 0)) return null;
  let cumulative = 0;
  for (let i = 0; i < 24; i++) {
    const h = (EATING_DAY_START + i) % 24;
    cumulative += p.hours[h] ?? 0;
    if (cumulative / sum >= DONE_EATING_SHARE) return h;
  }
  return (EATING_DAY_START + 23) % 24;
}

/**
 * The hour tonight's digest should fire for this person: one hour after they
 * are usually done eating, held inside 8pm to 11pm. Someone who always eats at
 * six is asked at eight instead of nine; someone who eats at ten is asked at
 * eleven. Under ten visits the weekday default stands, because a digest that
 * moves around on the strength of three dinners would feel random.
 *
 * Hours before EATING_DAY_START are the small hours after midnight. On the
 * eating-day axis they sit past 23, so the clamp lands them at the latest
 * slot rather than reading "1am" as an early night.
 */
export function personalDigestHour(p: EatingPattern | null, day: Date, fallback: number): number {
  if (!p || p.total < MIN_VISITS_FOR_DIGEST) return fallback;
  const dow = day.getDay();
  const usual = usualLastMealHour(p, dow === 5 || dow === 6);
  if (usual == null) return fallback;
  const onAxis = usual < EATING_DAY_START ? usual + 24 : usual;
  return Math.max(DIGEST_EARLIEST_HOUR, Math.min(DIGEST_LATEST_HOUR, onAxis + 1));
}

// ----------------------------------------------------------------------------
// Storage. Both directions swallow errors: the pattern is a refinement, and a
// storage hiccup must never take the confidence scorer or the digest down
// with it. A bad read simply means "no pattern yet".
// ----------------------------------------------------------------------------

function isEatingPattern(x: unknown): x is EatingPattern {
  if (!x || typeof x !== "object") return false;
  const p = x as Record<string, unknown>;
  const nums = (a: unknown, n: number) =>
    Array.isArray(a) && a.length === n && a.every((v) => typeof v === "number" && Number.isFinite(v));
  return (
    nums(p.hours, 24) &&
    nums(p.dows, 7) &&
    typeof p.total === "number" &&
    Number.isFinite(p.total) &&
    typeof p.updatedAt === "number"
  );
}

export async function saveEatingPattern(p: EatingPattern): Promise<void> {
  try {
    await AsyncStorage.setItem(EATING_PATTERN_KEY, JSON.stringify(p));
  } catch {
    // Best effort by design; see the section comment.
  }
}

export async function loadEatingPattern(): Promise<EatingPattern | null> {
  try {
    const raw = await AsyncStorage.getItem(EATING_PATTERN_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isEatingPattern(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
