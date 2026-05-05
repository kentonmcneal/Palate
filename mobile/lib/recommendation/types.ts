// ============================================================================
// recommendation/types.ts — formal contracts for the recommendation engine.
// ----------------------------------------------------------------------------
// One source of truth used by every screen. The spec mandates:
//   • compatibilityScore is context-FREE (no distance, no time, no open-now)
//   • finalScore = compat * 0.6 + contextFit * 0.3 + confidence * 0.1
//   • compatibility is calculated ONCE per (user, restaurant)
//
// All UI displays compatibilityScore as the headline % match.
// ============================================================================

export type RecommendationType =
  | "best_now"
  | "comfort"
  | "stretch"
  | "nearby"
  | "trending"
  | "hidden_gem"
  | "social"
  | "saved";

export type Confidence = "low" | "medium" | "high";

export type RestaurantInput = {
  google_place_id: string;
  name: string;
  cuisine_type?: string | null;
  cuisine_region?: string | null;
  cuisine_subregion?: string | null;
  format_class?: string | null;
  occasion_tags?: string[] | null;
  flavor_tags?: string[] | null;
  cultural_context?: string | null;
  neighborhood?: string | null;
  price_level?: number | null;
  rating?: number | null;
  user_rating_count?: number | null;
  latitude?: number | null;
  longitude?: number | null;
};

// ----------------------------------------------------------------------------
// COMPATIBILITY — context-FREE. Does NOT consider distance, hour, open-now.
// Computed once per (user, restaurant) and cached in memory.
//   compatibility = taste*0.50 + behavior*0.25 + social*0.10 + quality*0.10 + novelty*0.05
// ----------------------------------------------------------------------------
export type Compatibility = {
  /** 0..100 — the headline "% match" shown on every card. */
  score: number;
  /** Per-dimension subscores 0..100 */
  breakdown: {
    tasteFit: number;
    behaviorFit: number;
    noveltyFit: number;
    qualityFit: number;
    socialTrendFit: number;
  };
  /** "low" | "medium" | "high" — surfaced subtly in UI when low. */
  confidence: Confidence;
  /** 1-3 short, behavior-based reasons (no jargon). */
  reasons: string[];
  /** Tags that fired (for analytics + matched/stretched lists). */
  matchedSignals: string[];
};

// ----------------------------------------------------------------------------
// FINAL SCORE — context-aware. Used to RANK on the recs feed.
//   finalScore = compatibility * 0.60 + contextFit * 0.30 + confidence * 0.10
// ----------------------------------------------------------------------------
export type RestaurantScore = {
  restaurantId: string;        // google_place_id
  finalScore: number;          // 0..100, context-aware ranking
  compatibilityScore: number;  // 0..100, context-FREE — UI shows this as "% match"
  confidenceScore: number;     // 0..100
  // dimension subscores (0..100)
  tasteFit: number;
  contextFit: number;
  behaviorFit: number;
  noveltyFit: number;
  qualityFit: number;
  socialTrendFit: number;
  /** Composed user-facing explanation. Always present. */
  explanation: string;
  /** Bucket label — drives surface routing and analytics. */
  recommendationType: RecommendationType;
};

// ----------------------------------------------------------------------------
// CONTEXT — passed into the contextual layer (NOT into compatibility).
// ----------------------------------------------------------------------------
export type ScoreContext = {
  /** User's current location for distance + nearby gating */
  here?: { lat: number; lng: number };
  /** Current time — used for time-of-day / open-now */
  now?: Date;
  /** Hint at user mode — "right_now" tightens distance and time-of-day weight,
   *  "browsing" loosens them and rewards novelty more */
  mode?: "right_now" | "browsing" | "trip_planning";
};

// ----------------------------------------------------------------------------
// RANKED RESULT — what UI components render.
//
// `score` is the new canonical RestaurantScore (use this in new code).
// `match` is a backward-compat shim that mirrors the old PalateMatchScore
// shape so legacy components (RestaurantCompatibilityCard) keep working
// during the migration. Both fields are populated by the same Compatibility
// instance — they always agree.
// ----------------------------------------------------------------------------
export type RankedRestaurant = RestaurantInput & {
  score: RestaurantScore;
  /** Backward-compat: same data, old field name. Will be removed once every
   *  consumer reads from `.score` directly. */
  match: {
    score: number;          // mirror of compatibilityScore — the headline % match
    confidence: Confidence;
    reasons: string[];
    matchedSignals: string[];
    stretchSignals: string[];
    breakdown: {
      taste: number;
      behavior: number;
      context: number;
      novelty: number;
      aspirational: number;
      social: number;
    };
  };
  distanceKm: number | null;
};

// ----------------------------------------------------------------------------
// CANDIDATE POOLS — labeled buckets coming out of candidate generation.
// ----------------------------------------------------------------------------
export type CandidatePool =
  | "taste_similar"
  | "context_nearby"
  | "stretch_adjacent"
  | "social_trend"
  | "quality_baseline"
  | "saved";
