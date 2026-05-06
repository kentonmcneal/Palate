// ============================================================================
// lib/palate — Palate identity system (v2).
// ----------------------------------------------------------------------------
// Curator / Forager / Steward / Anchor — derived from a user's weekly eating
// behavior on two axes: Novelty ↔ Consistency, Casual ↔ Premium.
//
// All UI surfaces should import from here, never from the implementation
// files directly. This keeps the contract stable while internals can change.
// ============================================================================

export type {
  PrimaryIdentity, Quadrant, Tag, Confidence,
  UserWeeklyData, PalateProfile,
  CompatibilityType, CompatibilityResult,
} from "./palateTypes";

export {
  // Public scoring entry points
  getUserPalateProfile,
  getProfileFromVector,
  // Adapter
  vectorToWeeklyData,
  // Pure scoring functions (also used by tests)
  computeNoveltyScore,
  computePremiumScore,
  computeConfidence,
  classify,
  classifySecondary,
  applySmoothing,
  // Session cache
  getCachedProfile,
  setCachedProfile,
  clearProfileCache,
} from "./palateScoring";

export { deriveTags } from "./palateTags";

export {
  IDENTITY_BLURB,
  WHAT_ARE_PALATES,
  composeExplanation,
  composeBehaviorSignals,
  composeMovement,
} from "./palateCopy";

export {
  compareProfiles,
} from "./palateCompatibility";
