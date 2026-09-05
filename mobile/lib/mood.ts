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

// A dish is what people are actually in the mood for. "dish:tacos" rather
// than "tacos" so a dish can never collide with a cuisine slug.
export const DISH_PREFIX = "dish:";
export function dishMood(dish: string): string { return DISH_PREFIX + dish.toLowerCase().trim(); }
export function isDishMood(mood: Mood): boolean {
  return typeof mood === "string" && mood.startsWith(DISH_PREFIX);
}
export function dishOf(mood: Mood): string | null {
  return isDishMood(mood) ? String(mood).slice(DISH_PREFIX.length) : null;
}
const DISH_LABEL: Record<string, string> = {
  pizza: "Pizza", burgers: "Burgers", sandwiches: "Sandwiches", fried_chicken: "Fried chicken",
  wings: "Wings", tacos: "Tacos", bbq: "BBQ", steak: "Steak", seafood: "Seafood", sushi: "Sushi",
  ramen: "Ramen", noodles: "Noodles", dumplings: "Dumplings", salads: "Salads", brunch: "Brunch",
  bagels: "Bagels", donuts: "Donuts", ice_cream: "Ice cream", dessert: "Dessert", pastries: "Pastries",
  coffee: "Coffee", tea: "Tea", juice: "Juice", wine: "Wine", cocktails: "Cocktails", beer: "Beer",
};
export function dishLabel(dish: string): string {
  return DISH_LABEL[dish] ?? cuisineLabel(dish);
}

export function isIntentMood(mood: Mood): boolean {
  return typeof mood === "string" && INTENT_MOODS.has(mood);
}

// Format classes that mean "in and out" versus "sit and stay".
//
// Written against the real vocabulary rather than a guess at it. Across 1043
// classified restaurants: fast_casual 343, bar 255, quick_service 207, café
// 168, ghost_kitchen 26, casual_dining 24, fine_dining 7.
//
// The first version of these sets had "Sit down" as casual_dining + fine_dining
// — 31 rows, 3% of the database. Nearby that is reliably nothing, so the mood
// matched nothing, fell back to the full list, and read as a dead toggle. `bar`
// was in neither set despite being the second most common class in the data,
// and a bar is somewhere you sit.
//
// ghost_kitchen stays out of both: it is delivery-only, so it is neither a
// place you nip into nor one you sit in. An unlabelled venue is in neither set
// either — a mood must not claim something the classifier never established.
const QUICK_FORMATS = new Set([
  "quick_service", "fast_casual", "café", "cafe", "bakery",
]);
const SIT_DOWN_FORMATS = new Set([
  "casual_dining", "fine_dining", "bar",
]);

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
  // Quick and Sit down are gone from the row on the founder's call: a chip
  // row is for cuisines, "whatever is in the area", and two format chips at
  // the front pushed the cuisines off the screen. applyMood still understands
  // both, so the deep link and the tests keep working.
  return [
    { key: null, label: "Anything" },
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
  dish_family?: string[] | null;
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
  if (!mood) return { items: list, matched: true };
  // An empty pool used to report matched:true, which told the catalogue
  // fallback it was not needed — in exactly the sparse area it was built for.
  if (list.length === 0) return { items: list, matched: isIntentMood(mood) || isSurprise(mood) };

  if (isIntentMood(mood)) {
    const out = list.filter((r) => {
      const fmt = normalizeCuisine(r.format_class);
      if (mood === QUICK) return QUICK_FORMATS.has(fmt);
      if (mood === SIT_DOWN) return SIT_DOWN_FORMATS.has(fmt);
      return r.visited !== true; // SOMEWHERE_NEW
    });
    return out.length > 0 ? { items: out, matched: true } : { items: list, matched: false };
  }

  if (isDishMood(mood)) {
    const want = dishOf(mood) ?? "";
    const out = list.filter((r) => (r.dish_family ?? []).map(normalizeCuisine).includes(want));
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
  if (isSurprise(mood)) return "Nothing far enough outside your usual nearby. Here's the regular list.";
  if (mood === QUICK) return "Nothing quick nearby right now. Here's the regular list.";
  if (mood === SIT_DOWN) return "Nowhere to sit down nearby right now. Here's the regular list.";
  if (mood === SOMEWHERE_NEW) return "You've been to everything good nearby. Here's the regular list.";
  if (isDishMood(mood)) return `Nowhere for ${dishLabel(dishOf(mood) ?? "").toLowerCase()} nearby tonight. Closest picks instead.`;
  return `Nothing great nearby for ${cuisineLabel(String(mood))} tonight. Closest picks instead.`;
}

/** The label for any chip key: dish, cuisine, or intent. */
export function moodLabel(mood: Mood): string {
  if (!mood) return "Anything";
  if (isDishMood(mood)) return dishLabel(dishOf(mood) ?? "");
  if (mood === QUICK) return "Quick";
  if (mood === SIT_DOWN) return "Sit down";
  if (mood === SOMEWHERE_NEW) return "Somewhere new";
  if (isSurprise(mood)) return "Surprise me";
  return cuisineLabel(String(mood));
}


// ============================================================================
// Chips for what is actually AROUND you, not only what you already eat.
// ============================================================================
// buildMoodChips draws from the user's own cuisine breakdown, so a cuisine they
// have never eaten can never be offered. Someone who does not eat steak had no
// way to ask for a steakhouse, which is precisely when you would want to: a
// mood is about tonight, and tonight is often not the pattern.
//
// The pool is therefore the union: your habits first, because those chips get
// tapped most, then everything else nearby. A cuisine with nowhere to send you
// is not offered at all — a chip that returns the fallback list is worse than
// no chip.

/** Cuisines present in the nearby candidate pool, most common first. */
export function nearbyCuisines(
  pool: Array<{ cuisine_type?: string | null }>,
  minPlaces = 1,
): string[] {
  const counts = new Map<string, number>();
  for (const r of pool) {
    const c = (r.cuisine_type ?? "").toLowerCase().trim();
    if (!c || c === "other") continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= minPlaces)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c]) => c);
}

/**
 * The full chip row: intents, your habits, then anything else nearby.
 *
 * `mine` keeps its place at the front because those are the taps that happen.
 * The rest are what makes the row a way to ask for something, rather than a
 * summary of what you already do.
 */
export function buildCuisineChips(
  breakdown: CuisineSlice[],
  pool: Array<{ cuisine_type?: string | null }>,
  opts: { mineLimit?: number; totalLimit?: number } = {},
): MoodChip[] {
  const mineLimit = opts.mineLimit ?? 4;
  // Twelve: enough for every cuisine within 8km of a mid-size city.
  const totalLimit = opts.totalLimit ?? 12;

  const base = buildMoodChips(breakdown, mineLimit);
  const already = new Set(base.map((c) => String(c.key ?? "")));

  const extra: MoodChip[] = [];
  for (const c of nearbyCuisines(pool)) {
    if (extra.length >= totalLimit) break;
    if (already.has(c)) continue;
    extra.push({ key: c as Mood, label: cuisineLabel(c) });
  }

  // Surprise me, when present, stays last.
  const surpriseIdx = base.findIndex((c) => c.key === SURPRISE);
  if (surpriseIdx === -1) return [...base, ...extra];
  return [...base.slice(0, surpriseIdx), ...extra, base[surpriseIdx]];
}


/**
 * What to say above a cuisine you asked for but do not eat.
 *
 * Asking for steakhouses when you never eat steak is a legitimate request, and
 * the answer is the best steakhouses nearby with the truth attached — not an
 * empty list, and not a match percentage pretending you will love them. The old
 * behaviour filtered a ranked list to nothing and silently showed the unfiltered
 * one back, which reads as a broken toggle.
 *
 * `topScore` is the best compatibility in the filtered set, 0-100.
 */
export function moodContextNote(mood: Mood, topScore: number | null): string | null {
  if (!mood || isIntentMood(mood) || isSurprise(mood)) return null;
  if (topScore == null) return null;

  const label = moodLabel(mood);
  if (topScore >= 60) return null; // it speaks for itself
  if (topScore >= 45) return `${label} is not really your pattern. These are the closest fits.`;
  return `You have never gone in for ${label}. These are just the best ones near you.`;
}


// ============================================================================
// The row, with dishes first.
// ============================================================================
// Anything · Somewhere new · the dishes around you by how many places serve
// them · the cuisines not already covered by a dish · Surprise me. Dishes
// come from Google types via dish_family (0099), so this is free and it is
// what a person is actually in the mood for.
export type DishCount = { dish: string; place_count: number };

// Drinks are not dinner. They exist as dish families for Discover's filter;
// the mood row is about what to eat.
const NOT_A_MEAL = new Set(["coffee", "tea", "juice", "wine", "cocktails", "beer"]);

export function buildDishChips(
  breakdown: CuisineSlice[],
  pool: Array<{ cuisine_type?: string | null }>,
  dishes: DishCount[],
  opts: { dishLimit?: number; totalLimit?: number } = {},
): MoodChip[] {
  const dishLimit = opts.dishLimit ?? 8;
  const totalLimit = opts.totalLimit ?? 14;
  const dishChips: MoodChip[] = dishes
    .filter((d) => d.dish && !NOT_A_MEAL.has(d.dish) && d.place_count > 0)
    .slice(0, dishLimit)
    .map((d) => ({ key: dishMood(d.dish), label: dishLabel(d.dish) }));

  const cuisineRow = buildCuisineChips(breakdown, pool, { totalLimit });
  const surprise = cuisineRow.find((c) => c.key === SURPRISE);
  const cuisines = cuisineRow.filter((c) => c.key !== null && c.key !== SURPRISE && !isIntentMood(c.key));
  const intents = cuisineRow.filter((c) => c.key === null || isIntentMood(c.key));

  const out: MoodChip[] = [...intents, ...dishChips];
  for (const c of cuisines) {
    if (out.length >= totalLimit + intents.length) break;
    out.push(c);
  }
  return surprise ? [...out, surprise] : out;
}
