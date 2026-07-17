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

// ----------------------------------------------------------------------------
// National-chain denylist for the Right Now hero.
// "What should I eat right now?" should reach for the unique/independent/
// regional gem, not McDonald's. We detect by name pattern (Google Places
// doesn't reliably tag chains in its API).
//
// Regional chains intentionally NOT included (Whataburger, In-N-Out,
// Bojangles, Sheetz, Wawa, Cookout, Culver's, etc.) — they're often the
// "unique to a region" answer and SHOULD show up.
// ----------------------------------------------------------------------------
const NATIONAL_CHAIN_PATTERNS = [
  // Fast food
  "mcdonald", "burger king", "wendy", "taco bell", "kfc", "popeyes",
  "subway", "jersey mike", "jimmy john", "quiznos", "arby",
  "chick-fil-a", "chickfila", "raising cane", "zaxby",
  "domino", "pizza hut", "papa john", "little caesar", "marco's pizza",
  "panera", "chipotle", "qdoba", "moe's southwest", "el pollo loco",
  "panda express", "five guys", "shake shack", "smashburger",
  "sonic", "checkers", "white castle", "carl's jr", "hardee",
  "dairy queen", "baskin-robbins", "cold stone",
  // Coffee
  "starbucks", "dunkin", "caribou coffee", "tim horton", "peet's coffee",
  // Casual dining chains
  "applebee", "chili's", "tgi friday", "olive garden", "outback",
  "red lobster", "longhorn", "cheesecake factory", "ihop", "denny",
  "cracker barrel", "buffalo wild wings", "bdubs", "texas roadhouse",
  "ruby tuesday", "bonefish grill", "carrabba", "yard house",
  "p.f. chang", "pf chang", "the capital grille",
];

function isNationalChain(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase().trim();
  return NATIONAL_CHAIN_PATTERNS.some((p) => n.includes(p));
}

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

/**
 * "Try Another" strategy. Each tap on the hero card cycles to the next
 * strategy so the user feels the app is *thinking*, not just shuffling.
 *   • best    — default, finalScore ranking
 *   • closest — same pool, sorted by distance ascending
 *   • comfort — prefers low-novelty + high-confidence
 *   • stretch — prefers recommendationType="stretch" (adjacent novel)
 *   • quality — review count + rating dominates
 */
export type RightNowStrategy = "best" | "closest" | "comfort" | "stretch" | "quality";

export type RightNowOptions = {
  graph: TasteGraph;
  here: { lat: number; lng: number };
  now?: Date;
  /** Pre-fetched nearby — saves a network call when caller has it. */
  preFetched?: RestaurantInput[];
  /** Optional strategy bias for the rightNow slot. Default "best". */
  strategy?: RightNowStrategy;
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
  // Apply anti-staleness so a place visited 5x doesn't lock the slot.
  // Drop national chains entirely — "What should I eat right now?" should
  // reach for the unique pick, not McDonald's. Regional chains and
  // independents stay (the denylist is intentionally national-only).
  const baseFiltered = scored
    .filter((s) => {
      // Don't recommend places the user has visited 3+ times
      const visits = opts.graph.restaurantVisits[s.restaurant.google_place_id] ?? 0;
      return visits < 3;
    })
    .filter((s) => !isNationalChain(s.restaurant.name));

  const strategy: RightNowStrategy = opts.strategy ?? "best";
  const exploit = sortForStrategy(baseFiltered, strategy);

  // Exploration swap (only on the default "best" strategy — the explicit
  // strategies are user-chosen and shouldn't get randomized away).
  let rightNowPick: RankedRestaurant | null = null;
  if (strategy === "best" && Math.random() < EXPLORATION_RATE.right_now) {
    // Draw the exploration pick from baseFiltered, NOT scored — otherwise the
    // ~7% exploration branch bypasses the national-chain + visited-3x filters
    // and can surface exactly the McDonald's / been-there-5x pick the hero is
    // supposed to exclude.
    const stretchPool = baseFiltered
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

type ScoredCandidate = { restaurant: RankedRestaurant; pool: string };

/**
 * Strategy-specific sort. Each strategy filters / re-ranks `baseFiltered`
 * differently. Returned array is "best first" for THAT strategy. We always
 * fall back to finalScore when the strategy can't differentiate.
 */
function sortForStrategy(items: ScoredCandidate[], strategy: RightNowStrategy): ScoredCandidate[] {
  if (strategy === "closest") {
    return [...items]
      .filter((s) => s.restaurant.distanceKm != null)
      .sort((a, b) => {
        const da = a.restaurant.distanceKm ?? 999;
        const db = b.restaurant.distanceKm ?? 999;
        if (Math.abs(da - db) > 0.05) return da - db;
        return b.restaurant.score.finalScore - a.restaurant.score.finalScore;
      });
  }
  if (strategy === "comfort") {
    // Comfort = high compat, low novelty, high confidence. Penalize stretch.
    return [...items]
      .filter((s) => s.pool !== "stretch_adjacent")
      .sort((a, b) => {
        const aComfort = comfortScore(a.restaurant);
        const bComfort = comfortScore(b.restaurant);
        return bComfort - aComfort;
      });
  }
  if (strategy === "stretch") {
    // Stretch = adjacent novel. If we have actual stretch candidates, use
    // them; otherwise fall back to the next-best "best" pick so the user
    // doesn't see an empty card.
    const stretches = items
      .filter((s) =>
        s.pool === "stretch_adjacent" ||
        s.restaurant.score.recommendationType === "stretch")
      .sort((a, b) => b.restaurant.score.compatibilityScore - a.restaurant.score.compatibilityScore);
    if (stretches.length > 0) return stretches;
    return [...items].sort((a, b) => b.restaurant.score.finalScore - a.restaurant.score.finalScore);
  }
  if (strategy === "quality") {
    return [...items]
      .filter((s) => (s.restaurant.rating ?? 0) > 0)
      .sort((a, b) => qualityScore(b.restaurant) - qualityScore(a.restaurant));
  }
  // "best" — default
  return [...items]
    .filter((s) => s.pool !== "stretch_adjacent")
    .sort((a, b) => b.restaurant.score.finalScore - a.restaurant.score.finalScore);
}

function comfortScore(r: RankedRestaurant): number {
  const compat = r.score.compatibilityScore / 100;
  // noveltyFit is 0..100 on the flat RestaurantScore — normalize for the penalty.
  const novelty = (r.score.noveltyFit ?? 50) / 100;
  const conf = r.match.confidence === "high" ? 1 : r.match.confidence === "medium" ? 0.6 : 0.3;
  return compat * 1.0 + (1 - novelty) * 0.3 + conf * 0.2;
}

function qualityScore(r: RankedRestaurant): number {
  const rating = r.rating ?? 0;
  const reviews = Math.log10(1 + (r.user_rating_count ?? 0));
  return rating * 1.0 + reviews * 0.45;
}
