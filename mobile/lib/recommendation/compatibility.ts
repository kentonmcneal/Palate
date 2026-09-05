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
import { dislikePenalty } from "../dislikes";
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
const PERSONAL_NEGATIVE_CAP = 32;

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

  // Map to 0..100 with a gentle top-lift so a genuinely strong match lands in
  // the 90s (a linear map made even the best pick feel like ~45). The exponent
  // < 1 lifts the high end more than the low end; weak matches still read weak.
  // Floor 20 (never claim "bad" without data), cap 99 (never claim perfect).
  let raw = Math.round(Math.pow(composite01, 0.7) * 100);

  // Personal-signal adjustment: item ratings, friend visits, dismisses, skips.
  const personalDelta = computePersonalDelta(graph, r);
  // Asymmetric on purpose: a learned dislike may push further down than a
  // friend visit may push up. "I said no to this" is stronger evidence than
  // "a friend went".
  raw += clamp(personalDelta, -PERSONAL_NEGATIVE_CAP, PERSONAL_CAP);

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

// ----------------------------------------------------------------------------
// Flavor is switched off, and the number is the argument.
// ----------------------------------------------------------------------------
// Measured across the 1043 live rows: flavor_tags is empty on 482 of them
// (46%), averages 0.65 tags per row, and `rich` alone sits on 363 of the ~561
// rows that have any. So among tagged places roughly two in three carry the
// same tag, and half the catalogue carries none.
//
// That is worse than an absent attribute, not merely weaker than one. The
// scorers normalise over the attributes that are PRESENT, so carrying a
// near-constant tag bought a place extra observed weight — it counted as
// evidence while saying almost nothing, and the places with no tags were
// judged on a smaller denominator.
//
// Turning the weight to 0 rather than deleting the branch, because the fix is
// a data problem and not a code one. Classifier v1.8.0 tightens what gets
// tagged; when a reclassify has run, this comes back on if flavor_tags covers
// more than 80% of rows AND no single tag exceeds ~35% of the tagged ones.
// Until somebody can show those two numbers, the honest weight is zero.
const FLAVOR_WEIGHT = 0;

function scoreTaste(g: TasteGraph, r: RestaurantInput): Dim {
  // Compute whenever ANY taste signal exists — including a quiz-seeded persona
  // at 0 visits (the seed fills these maps but leaves totalVisits at 0, so the
  // old `totalVisits === 0` gate silently discarded it). True zero-signal =
  // neutral (the UI suppresses the number at low confidence regardless).
  // Gate on the attributes this block actually scores. Flavor is weight 0
  // and the onboarding quiz seeds flavor keys, so a brand-new account that
  // took the quiz had "entries" here, skipped the neutral branch, and scored
  // every restaurant 0 on taste — the quiz made cold start WORSE than no
  // quiz. Found by the code review, LIVE.
  if (!hasEntries(g.cuisinesSubregion) && !hasEntries(g.cuisines)
      && !(FLAVOR_WEIGHT > 0 && hasEntries(g.flavors))) {
    return { s: 0.5, matched: false };
  }
  let score = 0;
  let weight = 0;

  if (r.cuisine_subregion) {
    const aff = affinityOf(g.cuisinesSubregion, r.cuisine_subregion);
    score += aff * 0.5; weight += 0.5;
  }
  if (r.cuisine_region) {
    const aff = affinityOf(g.cuisines, r.cuisine_region);
    score += aff * 0.3; weight += 0.3;
  }
  if (FLAVOR_WEIGHT > 0 && r.flavor_tags?.length) {
    const overlap = sumAffinity(g.flavors, r.flavor_tags);
    score += overlap * FLAVOR_WEIGHT; weight += FLAVOR_WEIGHT;
  }
  const s = weight > 0 ? Math.min(1, score / weight) : 0.5;
  return { s, matched: s >= 0.4 };
}

function scoreBehavior(g: TasteGraph, r: RestaurantInput): Dim {
  if (!hasEntries(g.formats) && !hasEntries(g.occasions) && g.averagePriceLevel <= 0) {
    return { s: 0.5, matched: false };
  }
  let score = 0;
  let weight = 0;

  if (r.format_class) {
    const aff = affinityOf(g.formats, r.format_class);
    score += aff * 0.45; weight += 0.45;
  }
  if (r.occasion_tags?.length) {
    const overlap = sumAffinity(g.occasions, r.occasion_tags);
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
  if (!hasEntries(g.cuisinesSubregion) && !hasEntries(g.cuisines)) {
    return { s: 0.6, matched: false };
  }
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

  // What "Not interested" taught. Dampened by how much of this cuisine the
  // person has actually eaten: one dismissed taqueria does not outweigh forty
  // taco visits. The place itself never gets here; it is excluded upstream.
  const share = r.cuisine_subregion
    ? shareOf(g.cuisinesSubregion, r.cuisine_subregion)
    : r.cuisine_region ? shareOf(g.cuisines, r.cuisine_region) : 0;
  d -= dislikePenalty(g.dislikes, r, Math.round(share * g.totalVisits));

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
// Relative affinity: how strongly the user favors this bucket vs their OWN top
// bucket. Raw shareOf caps low — a favorite is rarely >0.3 of visits, since
// shares sum to 1 across all buckets — which compressed every match into the
// 30s-40s. Normalizing by the user's max share lets a #1-cuisine match reach
// ~1.0, so composite scores span a useful range again.
function maxValue(map: Record<string, number>): number {
  let m = 0;
  for (const n of Object.values(map)) if (n > m) m = n;
  return m;
}
function hasEntries(map: Record<string, number>): boolean {
  for (const _k in map) return true;
  return false;
}
function affinityOf(map: Record<string, number>, key: string): number {
  const m = maxValue(map);
  return m > 0 ? Math.min(1, (map[key] ?? 0) / m) : 0;
}
function sumAffinity(map: Record<string, number>, keys: string[]): number {
  let s = 0;
  for (const k of keys) s += affinityOf(map, k);
  return Math.min(1, s);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
