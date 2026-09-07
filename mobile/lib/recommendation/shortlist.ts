// ============================================================================
// recommendation/shortlist.ts — the three rows on Home.
// ----------------------------------------------------------------------------
// A ranking is not a shortlist. This turns one into the other with three
// rules, in order:
//
//   1. Rest. A place ignored three days running sits out until those passes
//      decay (feedback.ts isResting). Without it the strongest gem sat in
//      slot one on 27 of 30 simulated days whatever the person did.
//   2. Cap. Never more than two of one cuisine (reranking.ts capByKey); one
//      of one cuisine while the graph is thin, because three rows for
//      someone with two visits should be three different answers.
//   3. Explore. When the pattern is narrow — the top cuisine is 40% or more
//      of visits, or the two exploit rows share a cuisine — the third row is
//      a deliberate step outside it: the best-ranked place in a cuisine the
//      person has not eaten, adjacent to something they have (candidates.ts
//      isStretch), open, near, never something they said no to, not shown
//      in the last month, and not sitting on a pass. Chosen from the top
//      three such places with a random draw seeded by user and day, so it
//      holds still all day and changes tomorrow.
//
// The explore row is labelled and its events carry slot: "explore", so its
// outcomes can be read apart from the rows the model was sure about. A tap
// on it moves that place, like any other; only a visit teaches the graph.
// ============================================================================

import type { TasteGraph } from "./taste-graph";
import type { RestaurantInput } from "./types";
import { shareOf } from "./taste-graph";
import { capByKey } from "./reranking";
import { uniqueByBrand } from "./brand";
import { isStretch } from "./candidates";
import { isResting } from "./feedback";
import { dislikePenalty } from "../dislikes";
import { venueOpenAt } from "../opening-hours";

export const EXPLORE_TOP_SHARE = 0.40;
export const EXPLORE_MAX_KM = 4;
export const EXPLORE_UNSEEN_DAYS = 30;
export const EXPLORE_DRAW_FROM = 3;

export type ShortlistOptions<T> = {
  graph: TasteGraph;
  now: Date;
  /** Stable per person per day: `${userId}:${localDate}`. */
  seed: string;
  toInput: (t: T) => RestaurantInput;
  distanceKm?: (t: T) => number | null | undefined;
  size?: number;
  /** false while a mood chip is active: the person said what they want. */
  explore?: boolean;
};

export type Shortlist<T> = { picks: T[]; exploreIndex: number | null };

export function shortlist<T>(items: T[], opts: ShortlistOptions<T>): Shortlist<T> {
  const size = opts.size ?? 3;
  const g = opts.graph;
  const cuisineOf = (t: T) => opts.toInput(t).cuisine_type ?? null;
  const idOf = (t: T) => opts.toInput(t).google_place_id;

  // 1. Rest — unless resting would leave the list short.
  const fresh = items.filter((t) => !isResting(g.feedbackByPlace, idOf(t)));
  const rested = fresh.length >= size ? fresh : items;

  // 2. One location per restaurant. Ranked by compatibility, the top three
  //    nearby were Huey's Poplar, Huey's Southwind and Hueys Germantown: the
  //    same place three times, as the whole recommendation. The cuisine cap
  //    below cannot catch it, because three locations of one restaurant are
  //    one cuisine.
  //
  //    Same guard as the rest rule above: a pool too thin to fill the list
  //    without repeating a brand repeats the brand rather than coming back
  //    short. Better to say Huey's twice than to say nothing.
  const nameOf = (t: T) => opts.toInput(t).name;
  const chainOf = (t: T) => opts.toInput(t).chain_name;
  const oneEach = uniqueByBrand(rested, nameOf, chainOf);
  const base = oneEach.length >= size ? oneEach : rested;

  // 3. Cap.
  const thin = g.dataDepth === "low";
  const cap = thin ? 1 : 2;
  const exploit = capByKey(base, cuisineOf, cap, size);

  // 4. Explore.
  if (opts.explore === false || thin || exploit.length < size || size < 2) {
    return { picks: exploit, exploreIndex: null };
  }
  const top = topShare(g.cuisineTypes);
  const c0 = norm(cuisineOf(exploit[0]));
  const c1 = norm(cuisineOf(exploit[1]));
  const narrow = top >= EXPLORE_TOP_SHARE || (!!c0 && c0 === c1);
  if (!narrow) return { picks: exploit, exploreIndex: null };

  const keep = exploit.slice(0, size - 1);
  const keepIds = new Set(keep.map(idOf));
  const keepCuisines = new Set(keep.map((t) => norm(cuisineOf(t))).filter(Boolean));
  const unseenBefore = opts.now.getTime() - EXPLORE_UNSEEN_DAYS * 86_400_000;

  const pool = base.filter((t) => {
    const r = opts.toInput(t);
    if (keepIds.has(r.google_place_id)) return false;
    const c = norm(r.cuisine_type);
    if (!c || keepCuisines.has(c)) return false;
    if (shareOf(g.cuisineTypes, c) >= 0.05) return false;      // genuinely outside the pattern
    if (!isStretch(g, r)) return false;                          // ...but connected to it
    if (dislikePenalty(g.dislikes, r) > 0) return false;         // never something they said no to
    if (venueOpenAt(r.regular_opening_hours, opts.now) === false) return false;
    const km = opts.distanceKm?.(t);
    if (km != null && km > EXPLORE_MAX_KM) return false;
    const f = g.feedbackByPlace.get(r.google_place_id);
    if (f) {
      if (f.untaken >= 2 || f.skips > 0) return false;           // not a place they have been passing on
      if (f.lastSeenAt != null && f.lastSeenAt > unseenBefore) return false; // new to them, not just to the pattern
    }
    return true;
  });
  if (pool.length === 0) return { picks: exploit, exploreIndex: null };

  const draw = mulberry32(fnv1a(opts.seed));
  const pick = pool[Math.floor(draw() * Math.min(EXPLORE_DRAW_FROM, pool.length))];
  return { picks: [...keep, pick], exploreIndex: size - 1 };
}

/** The largest share any one key holds. 0 for an empty map. */
export function topShare(map: Record<string, number>): number {
  let max = 0, total = 0;
  for (const n of Object.values(map)) { total += n; if (n > max) max = n; }
  return total > 0 ? max / total : 0;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim();
}

// Small, seedable, deterministic. Same seed, same list, all day.
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `${userId}:${YYYY-MM-DD}` in local time — the explore seed. */
export function daySeed(userId: string | null | undefined, now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${userId ?? "anon"}:${y}-${m}-${d}`;
}
