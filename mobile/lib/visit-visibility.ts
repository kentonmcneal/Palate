// ============================================================================
// visit-visibility.ts — what belongs on the public profile.
// ----------------------------------------------------------------------------
// The private ledger is ALWAYS complete: every visit feeds recommendations and
// the taste model, regardless of what is shown. This file only answers a
// narrower question — should a newly logged visit appear on the profile by
// default, before the user has curated anything?
//
// NOT YET WIRED as the insert-time default. The recommendation below is
// argued, not assumed, and the call is Kenton's. `defaultVisitVisibility` is
// exported and tested so the decision can be made against real behaviour
// rather than a description of it.
// ============================================================================

import type { Restaurant } from "./places";

/**
 * Categories that are real meals but poor identity signals. A coffee run and a
 * drive-through are the clearest cases of something worth REMEMBERING and not
 * worth PUBLISHING — which is precisely the distinction the ledger/profile
 * split exists to make.
 */
const ROUTINE_FORMATS = new Set(["café", "cafe", "coffee_shop", "fast_food"]);

const ROUTINE_TYPES = new Set([
  "coffee_shop", "cafe", "fast_food_restaurant", "meal_takeaway",
  "donut_shop", "bagel_shop",
]);

export type VisibilityDefault = {
  isPublic: boolean;
  /** Why — surfaced in the UI so the default never feels arbitrary. */
  reason: "routine" | "chain" | "default";
};

/**
 * Whether a newly logged visit should start visible.
 *
 * Recommended shape: routine stops and national chains start HIDDEN, everything
 * else starts visible. The argument is that the profile is an identity object —
 * "how your friends actually eat" — and a feed of Starbucks runs is both untrue
 * to how someone thinks about their taste and boring to read. The visits still
 * exist, still count, still drive recommendations; they simply are not the
 * story someone tells about themselves.
 *
 * The counter-argument, which is real: hiding by default makes the profile
 * quieter for a new user with little history, and "curated" can shade into
 * "dishonest" for a product whose whole claim is revealed behaviour rather than
 * aspiration. If that weighs more, flip the two branches below — the plumbing
 * does not change.
 */
export function defaultVisitVisibility(place: Restaurant | null | undefined): VisibilityDefault {
  if (!place) return { isPublic: true, reason: "default" };

  const format = (place.cuisine_type ?? "").toLowerCase();
  const types = [place.primary_type, ...(place.types ?? [])].filter(Boolean) as string[];

  if (place.chain_name) return { isPublic: false, reason: "chain" };
  if (ROUTINE_FORMATS.has(format) || types.some((t) => ROUTINE_TYPES.has(t))) {
    return { isPublic: false, reason: "routine" };
  }
  return { isPublic: true, reason: "default" };
}

/** Copy for the curation surface, so the reason is legible rather than magic. */
/**
 * Why the DEFAULT for this visit was what it was — phrased as a reason, never
 * as a statement of current state.
 *
 * The previous version returned "Shown on your profile" / "Routine stop, hidden
 * from your profile by default", and curate-profile rendered it ONLY when the
 * current toggle disagreed with the suggestion. So the sentence was guaranteed
 * to contradict the switch beside it and the counter above it, every single
 * time it appeared: a screen reading "0 OF 2 SHOWN" with both toggles off, and
 * underneath a restaurant, the words "Shown on your profile".
 *
 * Reported by a tester who could not tell whether her visit was public. She was
 * not being picky; the app was telling her the opposite of the truth.
 *
 * The caller now states the real state first and appends this as the reason.
 */
export function visibilityReasonLabel(reason: VisibilityDefault["reason"]): string {
  switch (reason) {
    case "routine": return "routine stops are hidden by default";
    case "chain":   return "chains are hidden by default";
    default:        return "shown by default";
  }
}

/** What is actually true right now, for the row's first clause. */
export function visibilityStateLabel(isPublic: boolean): string {
  return isPublic ? "Shown on your profile" : "Hidden from your profile";
}
