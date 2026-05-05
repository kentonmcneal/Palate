// ============================================================================
// recommendation/compatibility.ts — the canonical "% match" score.
// ----------------------------------------------------------------------------
// Per spec:
//   compatibility = taste*0.50 + behavior*0.25 + social*0.10 + quality*0.10 + novelty*0.05
// Context-FREE — does NOT consider distance, hour, open-now, or any "right now"
// factor. That's all in scoring.ts.
//
// CONSISTENCY RULE: compatibility is calculated ONCE per (user, restaurant)
// and cached. Every screen reads the same value. Cache invalidates when
// personal signal changes (visit log, item rating, dismiss).
// ============================================================================

import type { Compatibility, RestaurantInput } from "./types";
import type { TasteGraph } from "./taste-graph";
import { shareOf, topKey } from "./taste-graph";
import { explainCompatibility } from "./explanations";

// Spec weights — sum to 1.00.
const W = {
  taste:  0.50,
  behavior: 0.25,
  social: 0.10,
  quality: 0.10,
  novelty: 0.05,
};

// Cap on how many points the personal-signal layer can shift the raw score.
// Stops a single dismiss from tanking a 90% match into 60%.
const PERSONAL_CAP = 18;

// ----------------------------------------------------------------------------
// Public entry — context-free, deterministic given (graph, restaurant).
// ----------------------------------------------------------------------------
export function computeCompatibility(graph: TasteGraph, r: RestaurantInput): Compatibility {
  const taste = scoreTaste(graph, r);
  const behavior = scoreBehavior(graph, r);
  const social = scoreSocial(graph, r);
  const quality = scoreQuality(r);
  const novelty = scoreNovelty(graph, r);

  // Composite 0..1 from spec weights
  const composite01 =
    taste.s * W.taste +
    behavior.s * W.behavior +
    social.s * W.social +
    quality.s * W.quality +
    novelty.s * W.novelty;

  // Map to 0..100. Floor at 20 (we never claim "we know it's bad" without data)
  // and cap at 99 (we never claim perfect).
  let raw = Math.round(composite01 * 100);

  // Personal-signal adjustment: item ratings, friend visits, dismisses, skips.
  const personalDelta = computePersonalDelta(graph, r);
  raw += clamp(personalDelta, -PERSONAL_CAP, PERSONAL_CAP);

  const score = Math.min(99, Math.max(20, raw));

  // Build matched signal list
  const matched: string[] = [];
  if (taste.matched) matched.push("taste");
  if (behavior.matched) matched.push("behavior");
  if (social.matched) matched.push("social");
  if (quality.matched) matched.push("quality");
  if (novelty.matched) matched.push("novelty");

  // Confidence comes from data depth + how many signals fired
  const confidence = decideConfidence(graph, matched.length);

  // Reasons — composed by explanations.ts so the language stays consistent
  const reasons = explainCompatibility(graph, r, {
    taste, behavior, social, quality, novelty,
    personalDelta,
  });

  return {
    score,
    breakdown: {
      tasteFit: Math.round(taste.s * 100),
      behaviorFit: Math.round(behavior.s * 100),
      socialTrendFit: Math.round(social.s * 100),
      qualityFit: Math.round(quality.s * 100),
      noveltyFit: Math.round(novelty.s * 100),
    },
    confidence,
    reasons,
    matchedSignals: matched,
  };
}

// ----------------------------------------------------------------------------
// Per-dimension scorers — each returns { s: 0..1, matched: bool }.
// ----------------------------------------------------------------------------

type Dim = { s: number; matched: boolean };

function scoreTaste(g: TasteGraph, r: RestaurantInput): Dim {
  if (g.totalVisits === 0) return { s: 0.5, matched: false }; // neutral cold-start
  let score = 0;
  let weight = 0;

  if (r.cuisine_subregion) {
    const share = shareOf(g.cuisinesSubregion, r.cuisine_subregion);
    score += share * 0.5; weight += 0.5;
  }
  if (r.cuisine_region) {
    const share = shareOf(g.cuisines, r.cuisine_region);
    score += share * 0.3; weight += 0.3;
  }
  if (r.flavor_tags?.length) {
    const overlap = sumShare(g.flavors, r.flavor_tags);
    score += overlap * 0.2; weight += 0.2;
  }
  const s = weight > 0 ? Math.min(1, score / weight) : 0.5;
  return { s, matched: s >= 0.4 };
}

function scoreBehavior(g: TasteGraph, r: RestaurantInput): Dim {
  if (g.totalVisits === 0) return { s: 0.5, matched: false };
  let score = 0;
  let weight = 0;

  if (r.format_class) {
    const share = shareOf(g.formats, r.format_class);
    score += share * 0.45; weight += 0.45;
  }
  if (r.occasion_tags?.length) {
    const overlap = sumShare(g.occasions, r.occasion_tags);
    score += overlap * 0.30; weight += 0.30;
  }
  // Price proximity — closer to user's average tier = higher
  if (r.price_level != null && g.averagePriceLevel > 0) {
    const diff = Math.abs(r.price_level - g.averagePriceLevel);
    const proximity = Math.max(0, 1 - diff / 3);
    score += proximity * 0.25; weight += 0.25;
  }
  const s = weight > 0 ? Math.min(1, score / weight) : 0.5;
  return { s, matched: s >= 0.4 };
}

function scoreSocial(g: TasteGraph, r: RestaurantInput): Dim {
  // Friend visits to this place
  const friends = g.friendVisitsByPlace.get(r.google_place_id) ?? 0;
  if (friends === 0 && (r.user_rating_count ?? 0) === 0) {
    return { s: 0.5, matched: false };
  }
  // Friend boost saturates fast: 1 friend = 0.6, 2+ = 0.9, 3+ = 1.0
  const friendBoost = friends === 0 ? 0
    : friends === 1 ? 0.6
    : friends >= 3 ? 1.0
    : 0.9;

  // Local popularity proxy via review count, log-scaled to dampen mega-chains
  const reviews = r.user_rating_count ?? 0;
  const popularity = Math.min(1, Math.log10(1 + reviews) / 4); // 10k reviews → 1.0

  // Friend signal weighs heavier than raw popularity (per spec — taste graph is the goal)
  const s = Math.min(1, friendBoost * 0.7 + popularity * 0.3);
  return { s, matched: friends > 0 || reviews >= 200 };
}

function scoreQuality(r: RestaurantInput): Dim {
  // Quality is a SAFEGUARD, not a primary signal (per spec).
  // Map Google rating 3.0..5.0 → 0..1.
  if (r.rating == null) return { s: 0.55, matched: false };
  const normalized = Math.max(0, Math.min(1, (r.rating - 3.0) / 2.0));
  // Discount low-volume ratings — a single 5-star is not signal.
  const reviews = r.user_rating_count ?? 0;
  const reviewWeight = Math.min(1, reviews / 100);
  const s = normalized * (0.4 + 0.6 * reviewWeight);
  return { s, matched: r.rating >= 4.3 && reviews >= 100 };
}

function scoreNovelty(g: TasteGraph, r: RestaurantInput): Dim {
  // Higher = MORE novel relative to user pattern.
  // Novelty is a small term in compatibility — it nudges, not dominates.
  if (g.totalVisits === 0) return { s: 0.6, matched: false };
  let novelty = 0.5;
  if (r.cuisine_subregion) {
    const share = shareOf(g.cuisinesSubregion, r.cuisine_subregion);
    novelty = 1 - share;
  } else if (r.cuisine_region) {
    const share = shareOf(g.cuisines, r.cuisine_region);
    novelty = 1 - share;
  }
  return { s: novelty, matched: false };
}

// ----------------------------------------------------------------------------
// Personal delta — additive points (-PERSONAL_CAP..PERSONAL_CAP) applied AFTER
// the dimensional composite. This is where loved/dismissed/friend signals get
// surfaced as interpretable bumps.
// ----------------------------------------------------------------------------
function computePersonalDelta(g: TasteGraph, r: RestaurantInput): number {
  let d = 0;

  // Item-level sentiment at this restaurant
  // (we don't have restaurants.id here, so this only fires for places the user
  //  has already visited — handled via place_id → restaurant_id elsewhere; safe to skip)

  // Item ↔ cuisine cross-learning: loved hummus → boost Mediterranean
  if (r.cuisine_type) {
    const c = g.itemSentimentByCuisine.get(r.cuisine_type);
    if (c) {
      const net = c.loved - c.not_for_me;
      d += clamp(net * 1.5, -8, 8);
    }
  }

  // Negative events
  const dismisses = g.dismissesByPlace.get(r.google_place_id) ?? 0;
  d -= Math.min(12, dismisses * 6);
  const skips = g.skipsByPlace.get(r.google_place_id) ?? 0;
  d -= Math.min(6, skips * 3);

  // Friend boost (subtle — friend signal is also in social dimension)
  const friends = g.friendVisitsByPlace.get(r.google_place_id) ?? 0;
  d += Math.min(4, friends * 1.5);

  return d;
}

// ----------------------------------------------------------------------------
// Confidence
// ----------------------------------------------------------------------------
function decideConfidence(g: TasteGraph, matched: number): "low" | "medium" | "high" {
  if (g.dataDepth === "low") return "low";
  if (g.dataDepth === "medium" || matched < 2) return "medium";
  return "high";
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function sumShare(map: Record<string, number>, keys: string[]): number {
  let s = 0;
  for (const k of keys) s += shareOf(map, k);
  return Math.min(1, s);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
