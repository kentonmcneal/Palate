// ============================================================================
// mood.ts — "in the mood for something else?"
// ----------------------------------------------------------------------------
// A tester put the problem precisely: Home says these are places you'll like,
// "but sometimes I eat a lot of burgers and I'm in the mood for Mexican."
//
// Every Home recommendation is a statement about the PAST — the taste graph is
// built from logged visits, so a burger-heavy month produces a burger-heavy
// feed. That is correct and also useless when you want something else tonight.
//
// A mood is a temporary override of the cuisine, NOT of the taste graph. When
// you pick Mexican you should get the best Mexican *for you* — the compat
// score still comes from your own history, we just restrict which venues are
// eligible for the slot. Swapping in a naive "any Mexican nearby" list would
// throw away the only thing that makes the recommendation ours.
//
// Selection is intentionally not persisted: a mood is about tonight.
// ============================================================================

import type { CuisineSlice } from "./analytics-stats";

/** null = "Anything" (the default, no override). */
export type Mood = string | null;

/** Deliberately outside the user's pattern. */
export const SURPRISE = "surprise";

// Moods that are not cuisines. A mood is not always "what food" — often it is
// "what kind of evening", and the row was only ever able to ask the first.
// Namespaced so a cuisine slug can never collide with one of these.
export const QUICK = "mood:quick";
export const SIT_DOWN = "mood:sit_down";
export const SOMEWHERE_NEW = "mood:new";

const INTENT_MOODS = new Set<string>([QUICK, SIT_DOWN, SOMEWHERE_NEW]);

export function isIntentMood(mood: Mood): boolean {
  return typeof mood === "string" && INTENT_MOODS.has(mood);
}

// Format classes that mean "in and out" versus "sit and stay". Anything the
// classifier has not labelled is in NEITHER set, so an unlabelled venue is
// never claimed by a mood it might not satisfy.
const QUICK_FORMATS = new Set(["quick_service", "fast_casual", "café", "cafe", "bakery"]);
const SIT_DOWN_FORMATS = new Set(["casual_dining", "fine_dining"]);

export type MoodChip = { key: Mood; label: string };

export function isSurprise(mood: Mood): boolean {
  return mood === SURPRISE;
}

/** Title-case a cuisine slug for display: "fast_casual" -> "Fast Casual". */
export function cuisineLabel(cuisine: string): string {
  return cuisine
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Chips for the mood row: Anything, the user's top cuisines, then Surprise me.
 *
 * "other" is dropped — it is a classifier fallback, not something anyone is in
 * the mood for. Cuisines with a single visit are dropped too: one visit is not
 * a habit, and a row of eight chips is a menu, not a shortcut.
 */
export function buildMoodChips(breakdown: CuisineSlice[], limit = 4): MoodChip[] {
  const named = breakdown.filter((c) => c.cuisine && c.cuisine !== "other");

  // Prefer real habits — two visits is a pattern, one is an outing. But a user
  // six visits in has maybe ONE cuisine at 2+, and offering them a single chip
  // is a worse answer than offering the handful of things they have actually
  // eaten. So: habits if there are enough of them, otherwise everything.
  const habits = named.filter((c) => c.count >= 2);
  const source = habits.length >= 2 ? habits : named;

  const top = source
    .slice(0, limit)
    .map((c) => ({ key: c.cuisine as Mood, label: cuisineLabel(c.cuisine) }));

  // Intents before cuisines. When you open this row you usually know what kind
  // of evening you want before you know what food, and "quick" is the single
  // most common answer at 7pm on a weekday.
  return [
    { key: null, label: "Anything" },
    { key: QUICK, label: "Quick" },
    { key: SIT_DOWN, label: "Sit down" },
    { key: SOMEWHERE_NEW, label: "Somewhere new" },
    ...top,
    // "Surprise me" means "outside your usual", which is not a thing that can
    // be said to somebody with no usual yet — with an empty habit set it would
    // match everything and duplicate "Anything".
    ...(top.length > 0 ? [{ key: SURPRISE, label: "Surprise me" }] : []),
  ];
}

/**
 * The one-line palate read above the row. Returns null when there isn't
 * enough history to say anything true — better silent than guessing.
 */
export function palateRead(breakdown: CuisineSlice[], minVisits = 3): string | null {
  const top = breakdown.find((c) => c.cuisine && c.cuisine !== "other");
  if (!top || top.count < minVisits) return null;
  return `Your palate's been ${cuisineLabel(top.cuisine)} lately.`;
}

type MoodCandidate = {
  cuisine?: string | null;
  format_class?: string | null;
  /** Whether the user has ever logged a visit here. Drives "Somewhere new". */
  visited?: boolean;
};

function normalizeCuisine(c: string | null | undefined): string {
  return (c ?? "").toLowerCase().trim();
}

/**
 * Apply a mood to an already-scored, already-sorted list.
 *
 * - Anything      → untouched
 * - a cuisine     → only that cuisine, order (i.e. personal fit) preserved
 * - Quick         → quick-service, fast casual, cafés and bakeries
 * - Sit down      → casual and fine dining
 * - Somewhere new → places with no logged visit
 * - Surprise      → only cuisines OUTSIDE the user's habit, order preserved
 *
 * Every branch preserves the incoming order, so what comes back is still
 * ranked by personal fit — a mood narrows what is eligible, it never re-scores.
 *
 * Never returns an empty list when the input was non-empty: an empty Home is a
 * worse answer than an imperfect one, so a mood that matches nothing falls
 * back to the unfiltered list and the caller says so in the UI.
 */
export function applyMood<T extends MoodCandidate>(
  list: T[],
  mood: Mood,
  habitualCuisines: string[],
): { items: T[]; matched: boolean } {
  if (!mood || list.length === 0) return { items: list, matched: true };

  if (isIntentMood(mood)) {
    const out = list.filter((r) => {
      const fmt = normalizeCuisine(r.format_class);
      if (mood === QUICK) return QUICK_FORMATS.has(fmt);
      if (mood === SIT_DOWN) return SIT_DOWN_FORMATS.has(fmt);
      return r.visited !== true; // SOMEWHERE_NEW
    });
    return out.length > 0 ? { items: out, matched: true } : { items: list, matched: false };
  }

  if (isSurprise(mood)) {
    const habit = new Set(habitualCuisines.map(normalizeCuisine));
    const out = list.filter((r) => {
      const c = normalizeCuisine(r.cuisine);
      return c.length > 0 && !habit.has(c);
    });
    return out.length > 0 ? { items: out, matched: true } : { items: list, matched: false };
  }

  const want = normalizeCuisine(mood);
  const out = list.filter((r) => normalizeCuisine(r.cuisine) === want);
  return out.length > 0 ? { items: out, matched: true } : { items: list, matched: false };
}

/** Copy for the empty-ish case, so the UI never silently lies about what it
 *  is showing. */
export function moodFallbackNote(mood: Mood): string {
  if (isSurprise(mood)) return "Nothing far enough outside your usual nearby — here's the regular list.";
  if (mood === QUICK) return "Nothing quick nearby right now — here's the regular list.";
  if (mood === SIT_DOWN) return "Nowhere to sit down nearby right now — here's the regular list.";
  if (mood === SOMEWHERE_NEW) return "You've been to everything good nearby — here's the regular list.";
  return `Nothing great nearby for ${cuisineLabel(String(mood))} tonight — closest picks instead.`;
}
