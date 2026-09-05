// ============================================================================
// match-score.ts — "% match for you" scoring + distance enrichment.
// ----------------------------------------------------------------------------
// For every recommendation surfaced to the user, we want to show:
//   - a 0-100 match score against their taste vector
//   - distance from their last known location (if available)
//   - a one-line "why this matches" explanation
//
// The score isn't a precise statistical metric — it's an interpretable signal
// that adds up matching dimensions and weights them by user strength. The
// goal is recognizable specificity ("88% match — your Italian + late-night
// pattern"), not academic accuracy.
// ============================================================================

import type { TasteVector } from "./taste-vector";
import type { RestaurantRecommendation } from "./palate-insights";
import {
  type PersonalSignal, personalAdjustment, timeOfDayBoost,
} from "./personal-signal";

const R_EARTH_KM = 6371;

/** Zero, and deliberately. flavor_tags is empty on 46% of the live catalogue
 *  and `rich` sits on two thirds of what remains, so it bought a place extra
 *  observed weight for saying almost nothing. The full argument, and the two
 *  measurements that would switch it back on, are on FLAVOR_WEIGHT in
 *  lib/recommendation/compatibility.ts. */
const FLAVOR_WEIGHT = 0;

/**
 * Total weight available if every attribute were populated: subregion 35,
 * region 20, format 15, occasion 15, flavor (0 today), price 10. The
 * neighbourhood bump is excluded because it is a bonus rather than a dimension
 * every candidate could score on.
 *
 * This is the denominator of the confidence weighting below, so it has to
 * follow FLAVOR_WEIGHT exactly. Leaving 10 in here while the branch adds
 * nothing would mean every place in the catalogue looked 10 points less
 * observed than it is, and nothing could ever reach full confidence.
 */
export const MAX_ATTRIBUTE_WEIGHT = 35 + 20 + 15 + 15 + FLAVOR_WEIGHT + 10;

export type MatchExplanation = {
  score: number;        // 0..100
  reasons: string[];    // 1-3 short why-bullets
};

export type ScoreMatchOptions = {
  /** Per-user signal layer — visit counts, dismissals, item ratings, friend
   *  visits. Pass when you have it; omit for stateless scoring. */
  personal?: PersonalSignal;
  /** google_place_id of the candidate — required to look up personal signals. */
  googlePlaceId?: string;
  /** restaurants.id — required for item-level sentiment lookup. */
  restaurantId?: string | null;
  /** Apply anti-staleness penalty for already-visited places. Turn ON for
   *  recommendation feeds (Home recs, Discover For-You); OFF for restaurant
   *  detail, search results, and the user's saved list. */
  applyStaleness?: boolean;
  /** When provided, factors a small "good for right now" boost from the
   *  restaurant's occasion tags vs. the current hour/day. */
  now?: Date;
};

export function scoreMatch(
  vector: TasteVector,
  rec: Pick<RestaurantRecommendation, "cuisine" | "price_level" | "neighborhood">,
  // Optional richer signals from the restaurants table
  context?: {
    cuisineRegion?: string | null;
    cuisineSubregion?: string | null;
    formatClass?: string | null;
    occasionTags?: string[] | null;
    flavorTags?: string[] | null;
  },
  options?: ScoreMatchOptions,
): MatchExplanation {
  const reasons: string[] = [];
  let raw = 0;
  let totalWeight = 0;

  // Cuisine subregion match (heaviest signal)
  if (context?.cuisineSubregion) {
    const share = shareOf(vector.cuisineSubregion, context.cuisineSubregion);
    raw += share * 35;
    totalWeight += 35;
    if (share >= 0.15) reasons.push(`Hits your ${humanize(context.cuisineSubregion)} pattern`);
  }
  // Cuisine region (lighter)
  if (context?.cuisineRegion) {
    const share = shareOf(vector.cuisineRegion, context.cuisineRegion);
    raw += share * 20;
    totalWeight += 20;
  }
  // Format match
  if (context?.formatClass) {
    const share = shareOf(vector.formatClass, context.formatClass);
    raw += share * 15;
    totalWeight += 15;
    if (share >= 0.4) reasons.push(`Matches your ${humanize(context.formatClass)} habit`);
  }
  // Occasion overlap
  if (context?.occasionTags?.length) {
    const overlap = sumShareAcross(vector.occasion, context.occasionTags);
    raw += overlap * 15;
    totalWeight += 15;
    if (overlap >= 0.3) reasons.push(`Right vibe for your ${topOf(vector.occasion)} pattern`);
  }
  // Flavor overlap — weight 0 today. See FLAVOR_WEIGHT in
  // lib/recommendation/compatibility.ts for the coverage numbers that turned
  // it off and the two that would turn it back on.
  if (FLAVOR_WEIGHT > 0 && context?.flavorTags?.length) {
    const overlap = sumShareAcross(vector.flavor, context.flavorTags);
    raw += overlap * FLAVOR_WEIGHT;
    totalWeight += FLAVOR_WEIGHT;
  }
  // Price tier proximity (closer to user's avg = higher)
  if (rec.price_level != null && vector.averagePriceLevel > 0) {
    const diff = Math.abs(rec.price_level - vector.averagePriceLevel);
    const proximity = Math.max(0, 1 - diff / 3); // 1.0 = exact, 0 = full 3-tier gap
    raw += proximity * 10;
    totalWeight += 10;
  }
  // Neighborhood familiarity bump
  if (rec.neighborhood) {
    const knownHood = vector.topNeighborhoods.find((n) => n.name === rec.neighborhood);
    if (knownHood) {
      raw += 8;
      totalWeight += 8;
      reasons.push(`In your usual ${rec.neighborhood} radius`);
    }
  }

  // Default floor: if no signal at all, give 50 (neutral). Never zero, which
  // would imply we know it is a bad match. We don't.
  //
  // CONFIDENCE WEIGHTING. `raw / totalWeight` normalises over only the
  // attributes that are PRESENT, which rewarded sparse tagging: a restaurant
  // with one populated attribute was judged on that attribute alone and could
  // reach 99, while a fully tagged one had to satisfy five dimensions to score
  // the same. Measured across the live catalogue, subregion is missing on 47%
  // of rows and carries the heaviest weight, so this was not a corner case —
  // the ranking partly measured how much we happened to KNOW about a place
  // rather than how well it fits.
  //
  // The fit is still the fit; it is now pulled toward neutral by how much of
  // the available evidence was actually observed. A place scored on 15 of 105
  // available weight lands near 50 whatever those 15 points said, and a
  // thoroughly described place that genuinely matches keeps its high score.
  const observed = totalWeight / MAX_ATTRIBUTE_WEIGHT;
  const confidence = Math.min(1, Math.max(0, observed));
  const fit = totalWeight > 0 ? (raw / totalWeight) * 100 : 50;
  let score = Math.round(50 + (fit - 50) * confidence);

  // ---- Personal signal layer ------------------------------------------------
  // Pull anti-staleness, dismissals, item-level loved/not-for-me, friend visits,
  // and item↔cuisine cross-learning into the composite. Bounded so no single
  // signal can dominate the base attribute fit.
  if (options?.personal && options.googlePlaceId) {
    const adj = personalAdjustment({
      signal: options.personal,
      googlePlaceId: options.googlePlaceId,
      restaurantId: options.restaurantId ?? null,
      cuisineType: rec.cuisine ?? null,
      applyStaleness: options.applyStaleness ?? false,
    });
    score += adj.delta;
    for (const note of adj.notes) reasons.push(note);
  }

  // ---- Time-of-day boost ----------------------------------------------------
  // Soft lift for restaurants whose occasion tags align with the current hour.
  // Cap intentionally low (≤6) so a "right now" match never overshadows fit.
  if (options?.now && context?.occasionTags) {
    score += timeOfDayBoost(context.occasionTags, options.now);
  }

  // Cap at 99 — we never claim perfect match, that's not honest.
  const capped = Math.min(99, Math.max(20, score));

  // If we couldn't generate any reason, fall back to a generic but honest one.
  if (reasons.length === 0) {
    reasons.push("Looks like the kind of place you usually pick");
  }
  return { score: capped, reasons: reasons.slice(0, 3) };
}

export function distanceKm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ----------------------------------------------------------------------------
// Match score color tiers — 4-step function for instant visual hierarchy.
// 80-100 → strong red    (this is for you)
// 60-79  → lighter red   (probably for you)
// 40-59  → light gray    (neutral)
// 0-39   → gray          (probably not for you)
// ----------------------------------------------------------------------------
const STRONG_RED  = "#E5391C";
const LIGHTER_RED = "#FF8266";
const LIGHT_GRAY  = "#B5B5B5";
const GRAY        = "#8E8E8E";

/**
 * The score as a word, at the precision the model actually has.
 *
 * The card used to lead with a large glowing figure — "93 match" — which
 * asserts that 93 and 88 are meaningfully different. They are not: the score is
 * a weighted sum of attribute overlaps with a neutral 50 floor and a hand-tuned
 * personal adjustment, so a few points is noise. Four bands is the real
 * resolution, and it is the same resolution matchScoreColor has always used.
 */
export function matchBand(score: number | null | undefined): string {
  if (score == null) return "Worth a look";
  if (score >= 80) return "Strong match";
  if (score >= 60) return "Good match";
  if (score >= 40) return "Worth a look";
  return "A stretch";
}

export function matchScoreColor(score: number | null | undefined): string {
  if (score == null) return GRAY;
  if (score >= 80) return STRONG_RED;
  if (score >= 60) return LIGHTER_RED;
  if (score >= 40) return LIGHT_GRAY;
  return GRAY;
}

/** Background tint — same tier mapping, low-opacity version. */
export function matchScoreTint(score: number | null | undefined): string {
  if (score == null) return "rgba(142,142,142,0.10)";
  if (score >= 80) return "rgba(255,48,8,0.12)";
  if (score >= 60) return "rgba(255,130,102,0.12)";
  if (score >= 40) return "rgba(181,181,181,0.18)";
  return "rgba(142,142,142,0.10)";
}

/** Format a distance for display: "0.3 mi" or "5 min walk". */
export function formatDistance(km: number): string {
  const mi = km * 0.621371;
  if (mi < 0.15) return "Right here";
  if (mi < 0.5) {
    const minutes = Math.round((km * 1000) / 80); // ~80m/min walk pace
    return `${minutes} min walk`;
  }
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function shareOf(map: Record<string, number>, key: string): number {
  const total = Object.values(map).reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  return (map[key] ?? 0) / total;
}

function sumShareAcross(map: Record<string, number>, keys: string[]): number {
  const total = Object.values(map).reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  let sum = 0;
  for (const k of keys) sum += map[k] ?? 0;
  return Math.min(1, sum / total);
}

function topOf(map: Record<string, number>): string {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  return entries[0] ? humanize(entries[0][0]) : "regular";
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
