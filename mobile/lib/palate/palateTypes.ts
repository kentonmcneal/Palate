// ============================================================================
// palateTypes.ts — shared type contracts for the Palate identity system.
// ----------------------------------------------------------------------------
// Two axes:
//   1. Novelty ↔ Consistency
//   2. Casual ↔ Premium  (premium is NOT just price)
//
// Four primary identities, by quadrant:
//
//          Premium ↑
//             |
//   Steward   |   Curator
//             |
//   <-- Consistency ----- Novelty -->
//             |
//   Anchor    |   Forager
//             |
//          Casual ↓
//
// Identity is dynamic — reflects "this week" not "permanent type."
// ============================================================================

export type PrimaryIdentity =
  | "Curator"     // high novelty + premium
  | "Forager"     // high novelty + casual
  | "Steward"     // low novelty + premium
  | "Anchor"      // low novelty + casual
  | "Learning";   // <4 visits — withhold classification

export type Quadrant = "curator" | "forager" | "steward" | "anchor";

export type Tag =
  // Distance
  | "Grounded"
  | "Roamer"
  // Time of day
  | "Brunch-heavy"
  | "Late-night"
  | "Weekday lunch"
  | "Cafe regular"
  // Social
  | "Group dining"
  | "Solo dining"
  | "Date-night"
  | "Friends-first"
  // Behavior
  | "High variety"
  | "Repeat favorite"
  | "Trend-aware"
  | "Planner"
  | "Comfort-driven"
  | "Stretching lately"
  | "Wellness-leaning"
  | "Cuisine-focused";

export type Confidence = "low" | "medium" | "high";

// ----------------------------------------------------------------------------
// INPUT — weekly aggregated user data. Missing fields default to neutral 0.5
// at the adapter layer; we never invent unavailable data.
// ----------------------------------------------------------------------------
export type UserWeeklyData = {
  totalVisits: number;
  newPlaceRate: number;                  // 0..1 — share of visits to new places
  repeatRate: number;                    // 0..1
  cuisineDiversity: number;              // 0..1
  neighborhoodDiversity: number;         // 0..1
  normalizedPriceLevel: number;          // 0..1 (price tier 1..4 → 0..1)
  independentRestaurantRate: number;     // 0..1 — non-chain share
  reservationOrOccasionSignal: number;   // 0..1 — date_night + group_dinner share
  elevatedCategorySignal: number;        // 0..1 — fine_dining + wine_bar share
  neighborhoodCount: number;             // distinct neighborhoods
  timeOfDayDistribution: {
    breakfast: number;
    brunch: number;
    lunch: number;
    dinner: number;
    lateNight: number;
  };
  socialDiningSignals: {
    groupDinner: number;                 // 0..1 share
    dateNight: number;
    casualSolo: number;
  };
};

// ----------------------------------------------------------------------------
// OUTPUT — the profile rendered in UI. All scores are 0..1.
// ----------------------------------------------------------------------------
export type PalateProfile = {
  primaryIdentity: PrimaryIdentity;
  /** Optional — only set when within ±0.10 of the threshold on either axis */
  secondaryIdentity?: PrimaryIdentity;
  confidence: Confidence;
  noveltyScore: number;                  // 0..1
  premiumScore: number;                  // 0..1
  tags: Tag[];                           // 3-4 max, ordered by signal strength
  /** 1-2 sentence headline copy — soft language for middle users */
  explanation: string;
  /** Concrete behavior signals to render as bullets ("3 of 5 visits to new spots") */
  behaviorSignals: string[];
  /** Optional movement vs. last week — only set when prior week is available */
  movement?: {
    /** "You moved toward Curator" / "You were more Roamer than last week" */
    summary: string;
    direction: "more_novel" | "more_consistent" | "more_premium" | "more_casual" | "stable";
  };
  /** Internal: the raw axis position (used by the axis graph) */
  position: { x: number; y: number };    // x = novelty (0..1), y = premium (0..1)
};

// ----------------------------------------------------------------------------
// COMPATIBILITY — scaffold only.
// ----------------------------------------------------------------------------
export type CompatibilityType =
  | "Easy Match"
  | "Balanced Match"
  | "Stretch Match"
  | "Friction Match";

export type CompatibilityResult = {
  type: CompatibilityType;
  /** 0..1 — distance between two profiles' axis positions, lower = closer */
  axisDistance: number;
  identityMatch: boolean;
  sharedSocialTags: Tag[];
  /** Short explanation — non-judgmental */
  summary: string;
};
