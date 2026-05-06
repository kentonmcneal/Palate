// ============================================================================
// palateCompatibility.ts — SCAFFOLD ONLY.
// ----------------------------------------------------------------------------
// Answers: "How easy or interesting would it be for these people to eat
// together?" — non-judgmental.
//
// This file intentionally exposes data structures + a basic classifier so the
// future Compatibility UI has something to render against. Full social-graph
// integration, conflict-of-interest sensing, and richer language land in a
// later pass.
// ============================================================================

import type {
  PalateProfile, CompatibilityResult, CompatibilityType, Tag,
} from "./palateTypes";

// ----------------------------------------------------------------------------
// classify() — the basic four-type classifier from spec.
// ----------------------------------------------------------------------------

const SOCIAL_TAGS: Tag[] = ["Group dining", "Solo dining", "Date-night", "Friends-first"];

export function compareProfiles(a: PalateProfile, b: PalateProfile): CompatibilityResult {
  // Identity match — same quadrant
  const identityMatch = a.primaryIdentity === b.primaryIdentity;

  // Axis distance — euclidean in (novelty, premium) space, normalized 0..1
  const dN = a.noveltyScore - b.noveltyScore;
  const dP = a.premiumScore - b.premiumScore;
  const axisDistance = Math.min(1, Math.sqrt(dN * dN + dP * dP) / Math.SQRT2);

  // Shared social tags
  const sharedSocialTags = a.tags.filter(
    (t) => SOCIAL_TAGS.includes(t) && b.tags.includes(t),
  );

  const type = decideType(identityMatch, axisDistance, sharedSocialTags);
  return {
    type,
    axisDistance,
    identityMatch,
    sharedSocialTags,
    summary: composeCompatibilitySummary(type, sharedSocialTags),
  };
}

function decideType(
  identityMatch: boolean,
  axisDistance: number,
  sharedSocial: Tag[],
): CompatibilityType {
  if (identityMatch && axisDistance < 0.25) return "Easy Match";
  if (axisDistance < 0.30 || sharedSocial.length >= 2) return "Balanced Match";
  if (axisDistance < 0.55) return "Stretch Match";
  return "Friction Match";
}

// Non-judgmental copy — every type framed as a different *kind* of fit, not
// "good" vs. "bad."
function composeCompatibilitySummary(type: CompatibilityType, sharedSocial: Tag[]): string {
  const sharedFragment = sharedSocial.length > 0
    ? ` You both lean ${sharedSocial[0].toLowerCase()}.`
    : "";

  switch (type) {
    case "Easy Match":
      return `You'll likely agree on the first three picks.${sharedFragment}`;
    case "Balanced Match":
      return `Different defaults, easy overlap.${sharedFragment}`;
    case "Stretch Match":
      return `Useful contrast — meals together can pull both of you somewhere new.${sharedFragment}`;
    case "Friction Match":
      return `You eat very differently. Plan dinner once and you'll know what to optimize for.${sharedFragment}`;
  }
}

// ----------------------------------------------------------------------------
// TODO (deferred — not in this pass):
//   • Loading the friend's PalateProfile from a shared backend table
//   • Group compatibility (3+ people)
//   • Per-occasion compatibility (date_night vs. group_dinner)
//   • Conflict-of-interest sensing (e.g. dietary restrictions)
//   • Rich, multi-line summary cards in UI
// ----------------------------------------------------------------------------
