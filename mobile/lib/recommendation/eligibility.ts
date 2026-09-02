// ============================================================================
// recommendation/eligibility.ts — the ONE gate every recommendation surface
// must pass its candidates through.
// ----------------------------------------------------------------------------
// Why this file exists: the hard gate in gems.ts was only ever called from
// candidates.ts. Four other surfaces built recommendations with a much weaker
// `recommendation_eligibility > 0` check, which lets an unclassified venue
// (eligibility null) straight through. That is how a tester's Home tab
// recommended Domino's Pizza at 31% match while the place-detail screen for the
// same venue said "National chain — not surfaced in discovery".
//
// RULE: a screen never re-implements eligibility. It calls filterRecommendable().
//
// Storage vs. recommendation stays separate on purpose. We keep classifying and
// logging every venue — if a user ate at Domino's, Wrapped should say so. This
// gate governs only what we PROPOSE.
// ============================================================================

import type { RestaurantInput } from "./types";
import { isRecIneligible, isCafeFormat, isGem } from "./gems";
import { isNationalChainName } from "./chains";

/** Anything with enough shape to judge. Loose on purpose: raw Google results,
 *  DB rows, and engine candidates all satisfy it. */
export type EligibilityInput = Pick<RestaurantInput, "name"> &
  Partial<RestaurantInput> & {
    /** Set by migration 0052: same normalized brand at >=3 distinct places. */
    is_chain_brand?: boolean | null;
  };

export type EligibilityOptions = {
  /**
   * Cafés/bakeries are near-excluded by default (they flooded the feed), with
   * genuine gems allowed through. Surfaces that are ABOUT cafés — the "cafes"
   * and "brunch" featured lists — pass "allow".
   */
  cafes?: "gems-only" | "allow";
};

/**
 * The single source of truth. Returns false for anything that must never be
 * recommended: fast food / quick-service formats, Google fast-food types,
 * classifier-flagged chains, name-matched national chains, DB-detected chain
 * brands, and classifier-downranked venues.
 */
export function isRecommendable(
  r: EligibilityInput,
  opts: EligibilityOptions = {},
): boolean {
  const input = r as RestaurantInput;

  // Hard gate — format class, Google fast-food types, classifier chain_name,
  // national-brand name match, DB chain-shape flag, classifier downrank.
  if (isRecIneligible(input)) return false;

  if (opts.cafes !== "allow" && isCafeFormat(input) && !isGem(input)) return false;

  return true;
}

/** Filter a list of candidates through the gate, preserving the caller's type. */
export function filterRecommendable<T extends EligibilityInput>(
  list: T[],
  opts: EligibilityOptions = {},
): T[] {
  return list.filter((r) => isRecommendable(r, opts));
}

/**
 * Why a venue was excluded — for the place-detail explainer and debug screens.
 * Returns null when the venue IS recommendable.
 */
export function ineligibilityReason(r: EligibilityInput): string | null {
  const input = r as RestaurantInput;
  if (isNationalChainName(r.name) || r.is_chain_brand === true || input.chain_name) {
    return "National chain — not surfaced in discovery.";
  }
  if (isRecIneligible(input)) return "Fast food — not surfaced in discovery.";
  if (isCafeFormat(input) && !isGem(input)) return "Café — surfaced only when it's a standout.";
  return null;
}
