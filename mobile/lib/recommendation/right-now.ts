// ============================================================================
// recommendation/right-now.ts — the contextual "What should I eat right now?"
// ----------------------------------------------------------------------------
// Returns EXACTLY ONE restaurant. Dynamic weights based on context:
//
//   • Hungry / near meal time     → context up, exploration down to 5-10%
//   • Browsing casually           → novelty up, exploration up to 30%
//   • Low data (<3 visits)        → leans on quality + popularity baselines
//   • High data (12+ visits)      → leans on logged behavior + taste graph
//
// Ranking signal stack (per spec):
//   1. compatibility score (the headline % match)
//   2. distance penalty
//   3. time-of-day fit
//   4. anti-staleness (visit count > 2 → demote)
//   5. novelty within mid-band (not random; adjacent only)
// ============================================================================

import type { RankedRestaurant, RestaurantInput } from "./types";
import type { TasteGraph } from "./taste-graph";
import { generateCandidates } from "./candidates";
import { computeCompatibility } from "./compatibility";
import { scoreRestaurant, scoreContext } from "./scoring";
import { explainRightNow, type RightNowExplanation } from "./explanations";
import { distanceKm } from "../match-score";

// Build the legacy `.match` shim (same data, old field name) so existing
// UI components like RightNowHero / StretchPick / RestaurantCompatibilityCard
// keep working. This must mirror buildRankedRestaurant in ./index.ts.
function legacyMatch(graph: TasteGraph, r: RestaurantInput, contextFit: number) {
  const compat = computeCompatibility(graph, r);
  return {
    score: compat.score,
    confidence: compat.confidence,
    reasons: compat.reasons,
    matchedSignals: compat.matchedSignals,
    stretchSignals: [] as string[],
    breakdown: {
      taste: compat.breakdown.tasteFit,
      behavior: compat.breakdown.behaviorFit,
      context: contextFit,
      novelty: compat.breakdown.noveltyFit,
      aspirational: 0,
      social: compat.breakdown.socialTrendFit,
    },
  };
}

// Exploration rate per surface (per spec)
const EXPLORATION_RATE = {
  right_now: 0.07,      // 7% — fast decisions need confidence
  probably_like: 0.12,
  stretch: 0.50,
};

// We always surface the top scorer (no hard floor) — "Try another" cycles
// down by score so the user can keep exploring. Empty-state only fires when
// there are literally no candidates. Per latest UX feedback: showing the
// best available beats showing nothing, even if compat isn't 80+.

export type RightNowPick = {
  restaurant: RankedRestaurant;
  explanation: RightNowExplanation;
  /** "high" | "medium" | "low" — lifted from the compatibility signal. */
  confidence: "high" | "medium" | "low";
};

export type RightNowResult = {
  rightNow: RightNowPick | null;
  stretch: RightNowPick | null;
};

export type RightNowOptions = {
  graph: TasteGraph;
  here: { lat: number; lng: number };
  now?: Date;
  /** Pre-fetched nearby — saves a network call when caller has it. */
  preFetched?: RestaurantInput[];
};

export async function computeRightNow(opts: RightNowOptions): Promise<RightNowResult> {
  const candidates = await generateCandidates({
    graph: opts.graph,
    here: opts.here,
    preFetched: opts.preFetched,
  });
  if (candidates.length === 0) return { rightNow: null, stretch: null };

  const now = opts.now ?? new Date();

  // Score every candidate. Compatibility is canonical (single value per
  // restaurant), context is fresh per call, finalScore composes them.
  // Populate the `.match` shim so legacy UI components (which still read
  // `r.match.score`) keep working.
  const scored = candidates.map((c) => {
    const score = scoreRestaurant(opts.graph, c.restaurant, {
      here: opts.here, now, mode: "right_now",
    });
    const distKm = distanceOf(c.restaurant, opts.here);
    const match = legacyMatch(opts.graph, c.restaurant, score.contextFit);
    return {
      restaurant: { ...c.restaurant, score, match, distanceKm: distKm } as RankedRestaurant,
      pool: c.pool,
    };
  });

  // ---- Right Now: exploit (93%) -----------------------------------------
  // Sort by finalScore (compat * 0.6 + context * 0.3 + conf * 0.1).
  // Apply anti-staleness so a place visited 5x doesn't lock the slot.
  // No compatibility floor — we always show the best available pick. The
  // user can tap "Try another" to cycle down the list.
  const exploit = scored
    .filter((s) => {
      // Don't recommend places the user has visited 3+ times
      const visits = opts.graph.restaurantVisits[s.restaurant.google_place_id] ?? 0;
      return visits < 3;
    })
    .filter((s) => s.pool !== "stretch_adjacent")
    .sort((a, b) => b.restaurant.score.finalScore - a.restaurant.score.finalScore);

  // Optionally swap top pick with a stretch candidate (5-10% exploration)
  const useExploration = Math.random() < EXPLORATION_RATE.right_now;
  let rightNowPick: RankedRestaurant | null = null;
  if (useExploration) {
    const stretchPool = scored
      .filter((s) => s.pool === "stretch_adjacent" || s.restaurant.score.recommendationType === "stretch")
      .sort((a, b) => b.restaurant.score.compatibilityScore - a.restaurant.score.compatibilityScore);
    rightNowPick = stretchPool[0]?.restaurant ?? exploit[0]?.restaurant ?? null;
  } else {
    rightNowPick = exploit[0]?.restaurant ?? null;
  }

  // ---- Stretch slot: pick the MOST NOVEL adjacent option ----
  // Per latest feedback, Stretch is "outside your usual" — so we pick the
  // LOWEST compat among stretch candidates (real exploration lives there).
  // High-compat picks already win Right Now + the recs list.
  const stretchScored = scored
    .filter((s) =>
      s.pool === "stretch_adjacent" ||
      s.restaurant.score.recommendationType === "stretch")
    .filter((s) => s.restaurant.google_place_id !== rightNowPick?.google_place_id)
    .sort((a, b) => a.restaurant.score.compatibilityScore - b.restaurant.score.compatibilityScore);
  const stretchPick = stretchScored[0]?.restaurant ?? null;

  return {
    rightNow: rightNowPick ? buildPick(rightNowPick, opts.graph, false) : null,
    stretch: stretchPick ? buildPick(stretchPick, opts.graph, true) : null,
  };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function buildPick(r: RankedRestaurant, graph: TasteGraph, isStretch: boolean): RightNowPick {
  const compat = computeCompatibility(graph, r);
  return {
    restaurant: r,
    explanation: explainRightNow({
      compat,
      distanceKm: r.distanceKm,
      isStretch,
    }),
    confidence: compat.confidence,
  };
}

function distanceOf(r: RestaurantInput, here: { lat: number; lng: number } | null): number | null {
  if (!here || r.latitude == null || r.longitude == null) return null;
  return distanceKm(here, { lat: r.latitude, lng: r.longitude });
}
