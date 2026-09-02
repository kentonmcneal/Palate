// ============================================================================
// passive-confidence.ts — how sure are we that this stop was this restaurant?
// ----------------------------------------------------------------------------
// Drives three things: ordering in the digest, whether an entry arrives
// pre-checked, and whether a real-time prompt is allowed at all.
//
// Every sub-score is 0-1 and the weights sum to 1, so the result is directly
// interpretable — no magic constants that only make sense together. The
// weighting is a starting point to be tuned against calibration data (see
// docs/CAPTURE_SPEC.md), not a claim to have got it right first time.
// ============================================================================

import type { Restaurant } from "./places";
import { mealWindow } from "./passive-pipeline";

export type ConfidenceBand = "high" | "medium" | "low";

export const HIGH_BAND_MIN = 0.75;
export const MEDIUM_BAND_MIN = 0.4;

// Venue density is deliberately NOT in this table. It is not evidence about the
// stop — it is a limit on how much any evidence can tell you. On a food-hall
// block every signal here can be perfect while the answer remains a coin flip
// between four doors, so density is applied as a CEILING below.
export const CONFIDENCE_WEIGHTS = {
  dwell: 0.33,
  accuracy: 0.27,
  mealFit: 0.2,
  priorVisits: 0.13,
  category: 0.07,
};

/** Multiplier applied when the venue was closed. Near-zero, not zero: hours
 *  data is imperfect and a hard zero would make a stale record unrecoverable. */
export const CLOSED_VENUE_PENALTY = 0.1;

const DWELL_SATURATION_MIN = 60;
const ACCURACY_BEST_M = 20;
const ACCURACY_WORST_M = 100;

const FOOD_PRIMARY_TYPES = [
  "restaurant", "bar", "cafe", "coffee_shop", "bakery", "deli",
  "fast_food_restaurant", "sandwich_shop", "pizza_restaurant",
  "steak_house", "fine_dining_restaurant", "brunch_restaurant",
  "breakfast_restaurant", "ice_cream_shop", "meal_takeaway",
];

const MEAL_TYPE_HINTS: Record<string, string[]> = {
  breakfast: ["bakery", "cafe", "coffee_shop", "breakfast_restaurant", "brunch_restaurant"],
  lunch: ["sandwich_shop", "fast_food_restaurant", "cafe", "deli", "restaurant"],
  dinner: ["restaurant", "bar", "steak_house", "fine_dining_restaurant", "pizza_restaurant"],
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Log-shaped and saturating. The first few minutes carry more information than
 * the last few: 5 -> 20 minutes is a much bigger change in what we believe than
 * 45 -> 60. A linear ramp would score a genuine five-minute counter-service
 * meal as near-worthless.
 */
export function dwellScore(dwellMin: number): number {
  if (dwellMin <= 0) return 0;
  const scale = Math.log(1 + DWELL_SATURATION_MIN / 5);
  return clamp01(Math.log(1 + dwellMin / 5) / scale);
}

export function accuracyScore(accuracyM: number): number {
  const span = ACCURACY_WORST_M - ACCURACY_BEST_M;
  return clamp01(1 - (accuracyM - ACCURACY_BEST_M) / span);
}

/**
 * The most confidence that N plausible venues in range permits, regardless of
 * how good everything else looks.
 *
 * This is the mechanism that keeps dense retail out of the High band and
 * therefore out of pre-check and real-time prompts, which is what the spec
 * requires. Three or more candidates can never reach High: 1/(1+0.3*2) = 0.63.
 */
export function densityCeiling(candidateCount: number): number {
  if (candidateCount <= 1) return 1;
  return clamp01(1 / (1 + 0.3 * (candidateCount - 1)));
}

export function mealFitScore(place: Restaurant, hour: number): number {
  const window = mealWindow(hour);
  if (window === "off") return 0.25;
  const hints = MEAL_TYPE_HINTS[window] ?? [];
  const types = [place.primary_type, ...(place.types ?? [])].filter(Boolean) as string[];
  return types.some((t) => hints.includes(t)) ? 1 : 0.7;
}

/** A repeat visit is strong positive evidence. Its ABSENCE is weak evidence of
 *  anything — everywhere is a first visit once — hence 0.5 rather than 0. */
export function priorVisitScore(visitedBefore: boolean): number {
  return visitedBefore ? 1 : 0.5;
}

export function categoryScore(place: Restaurant): number {
  const types = [place.primary_type, ...(place.types ?? [])].filter(Boolean) as string[];
  return types.some((t) => FOOD_PRIMARY_TYPES.includes(t)) ? 1 : 0.5;
}

export type ConfidenceInput = {
  dwellMin: number;
  accuracyM: number;
  /** How many plausible venues were in range — the honest measure of ambiguity. */
  candidateCount: number;
  hour: number;
  place: Restaurant;
  visitedBefore: boolean;
  /**
   * Whether the venue was open at the time. Opening hours are NOT stored yet
   * (see docs/CAPTURE_SPEC.md); this is the slot for the strongest cheap veto
   * we have identified. undefined means unknown and is not penalised.
   */
  venueOpen?: boolean | null;
};

export function confidenceScore(input: ConfidenceInput): number {
  const w = CONFIDENCE_WEIGHTS;
  const evidence =
    w.dwell * dwellScore(input.dwellMin) +
    w.accuracy * accuracyScore(input.accuracyM) +
    w.mealFit * mealFitScore(input.place, input.hour) +
    w.priorVisits * priorVisitScore(input.visitedBefore) +
    w.category * categoryScore(input.place);

  // Ambiguity caps what the evidence is allowed to claim.
  const capped = Math.min(evidence, densityCeiling(input.candidateCount));

  // A closed venue is the one signal strong enough to override everything else.
  const penalty = input.venueOpen === false ? CLOSED_VENUE_PENALTY : 1;
  return clamp01(capped * penalty);
}

export function confidenceBand(score: number): ConfidenceBand {
  if (score >= HIGH_BAND_MIN) return "high";
  if (score >= MEDIUM_BAND_MIN) return "medium";
  return "low";
}
