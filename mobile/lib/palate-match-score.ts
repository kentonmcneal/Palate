// ============================================================================
// palate-match-score.ts — Palate Match Score (0..100) per restaurant.
// ----------------------------------------------------------------------------
// "How likely is this user to actually like this restaurant?"
// Not "how popular is this restaurant?"
//
// Rule-based v1, transparent. Easy swap-out point for an ML model later
// because the contract is small: in = (vector, restaurant, context),
// out = { score, confidence, reasons, matchedSignals, stretchSignals }.
//
// Weights (sum to 1.00):
//   taste_fit          0.30
//   behavior_fit       0.25
//   context_fit        0.20
//   novelty_fit        0.10
//   aspirational_fit   0.10
//   social_proof       0.05
//
// Google rating contributes only via social_proof and is capped — a 4.2
// place that fits ranks above a 4.8 that doesn't.
// ============================================================================

import type { TasteVector } from "./taste-vector";
import { type PersonalSignal, personalAdjustment } from "./personal-signal";

export type MatchConfidence = "low" | "medium" | "high";

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

export type ScoreContext = {
  /** "lunch" / "dinner" / "late_night" / "brunch" / "breakfast" / undefined (auto from clock) */
  occasion?: string;
  /** Local time at scoring (used to infer occasion if not provided) */
  now?: Date;
  /** User's current location (km distance penalty when far) */
  here?: { lat: number; lng: number };
  /** Day-of-week match (0=Sun..6=Sat) — derived from `now` if absent */
  dayOfWeek?: number;
  /** Force "stretch" mode — caller knows this is a stretch slot */
  intent?: "safe" | "stretch" | "aspirational" | "neutral";
  /** Per-user signal layer — visit counts, dismissals, item ratings, friend
   *  visits, item↔cuisine cross-learning. */
  personal?: PersonalSignal;
  /** restaurants.id for item-level lookups. */
  restaurantId?: string | null;
  /** When true, anti-staleness penalizes already-visited spots. */
  applyStaleness?: boolean;
};

export type SignalHit = {
  /** Short tag for analytics + matchedSignals[]. */
  key: string;
  /** Human-readable explanation, used in `reasons[]`. */
  reason: string;
  /** 0..1 contribution within its dimension. */
  strength: number;
};

export type PalateMatchScore = {
  score: number;                 // 0..100, capped to [35, 99] so it's never absolute
  confidence: MatchConfidence;
  reasons: string[];             // 1-3 short user-facing lines
  matchedSignals: string[];      // tags of dimensions that hit
  stretchSignals: string[];      // tags of dimensions that DIDN'T hit but are interesting
  /** Per-dimension subscores 0..100, exposed for debugging + bucket routing. */
  breakdown: {
    taste: number;
    behavior: number;
    context: number;
    novelty: number;
    aspirational: number;
    social: number;
  };
};

const WEIGHTS = {
  taste:        0.30,
  behavior:     0.25,
  context:      0.20,
  novelty:      0.10,
  aspirational: 0.10,
  social:       0.05,
};

// ----------------------------------------------------------------------------
// Public entry point
// ----------------------------------------------------------------------------
export function calculatePalateMatchScore(
  vector: TasteVector | null,
  restaurant: RestaurantInput,
  context: ScoreContext = {},
): PalateMatchScore {
  const matched: SignalHit[] = [];
  const stretch: SignalHit[] = [];

  // ---- 1. TASTE FIT ----
  const taste = scoreTaste(vector, restaurant, matched, stretch);
  // ---- 2. BEHAVIOR FIT ----
  const behavior = scoreBehavior(vector, restaurant, matched, stretch);
  // ---- 3. CONTEXT FIT ----
  const ctxNow = context.now ?? new Date();
  const occasion = context.occasion ?? inferOccasion(ctxNow);
  const dow = context.dayOfWeek ?? ctxNow.getDay();
  const contextScore = scoreContext(vector, restaurant, occasion, dow, context.here, matched, stretch);
  // ---- 4. NOVELTY FIT ----
  const novelty = scoreNovelty(vector, restaurant, context.intent ?? "neutral", matched, stretch);
  // ---- 5. ASPIRATIONAL FIT ----
  const aspirational = scoreAspirational(vector, restaurant, matched, stretch);
  // ---- 6. SOCIAL PROOF (capped) ----
  const social = scoreSocial(restaurant, matched);

  const composite =
    taste * WEIGHTS.taste +
    behavior * WEIGHTS.behavior +
    contextScore * WEIGHTS.context +
    novelty * WEIGHTS.novelty +
    aspirational * WEIGHTS.aspirational +
    social * WEIGHTS.social;

  // Map 0..1 to a "trustworthy" 35..99 range. We never claim 100% match —
  // it's not honest, and we never claim < 35% — implies we know it's bad.
  let score = Math.round(35 + composite * 64);

  // ---- Personal signal layer ------------------------------------------------
  // Apply anti-staleness, dismissals, item-level loved/not-for-me, friend
  // boost, and item↔cuisine cross-learning. Bounded inside personalAdjustment
  // so a single signal can't dominate the composite.
  if (context.personal) {
    const adj = personalAdjustment({
      signal: context.personal,
      googlePlaceId: restaurant.google_place_id,
      restaurantId: context.restaurantId ?? null,
      cuisineType: restaurant.cuisine_type ?? null,
      applyStaleness: context.applyStaleness ?? false,
    });
    score += adj.delta;
    for (const note of adj.notes) matched.push({ key: "personal", reason: note, strength: 0.5 });
  }

  const confidence = computeConfidence(vector, matched.length);

  // De-dupe + sort matched/stretch by strength
  const matchedSignals = uniq(matched.sort((a, b) => b.strength - a.strength).map((s) => s.key));
  const stretchSignals = uniq(stretch.map((s) => s.key));
  const reasons = uniq(matched.sort((a, b) => b.strength - a.strength).map((s) => s.reason)).slice(0, 3);

  return {
    score: Math.min(99, Math.max(20, score)),
    confidence,
    reasons: reasons.length > 0 ? reasons : ["Worth a look — this fits the kind of place you usually pick."],
    matchedSignals,
    stretchSignals,
    breakdown: {
      taste: pct(taste),
      behavior: pct(behavior),
      context: pct(contextScore),
      novelty: pct(novelty),
      aspirational: pct(aspirational),
      social: pct(social),
    },
  };
}

// ============================================================================
// Per-dimension scoring (each returns 0..1)
// ============================================================================

function scoreTaste(
  v: TasteVector | null, r: RestaurantInput,
  matched: SignalHit[], stretch: SignalHit[],
): number {
  if (!v) return 0.5; // neutral if we have no vector
  let score = 0;
  let weight = 0;

  if (r.cuisine_subregion) {
    const share = shareOf(v.cuisineSubregion, r.cuisine_subregion);
    score += share * 0.5; weight += 0.5;
    if (share >= 0.15) matched.push({ key: "cuisine_subregion", reason: `Hits your ${humanize(r.cuisine_subregion)} pattern.`, strength: share });
    else if (share === 0) stretch.push({ key: "cuisine_subregion_new", reason: `New subregion for you.`, strength: 0.3 });
  }
  if (r.cuisine_region) {
    const share = shareOf(v.cuisineRegion, r.cuisine_region);
    score += share * 0.3; weight += 0.3;
    if (share >= 0.2) matched.push({ key: "cuisine_region", reason: `In your usual ${humanize(r.cuisine_region)} lane.`, strength: share });
  }
  if (r.price_level != null && v.averagePriceLevel > 0) {
    const diff = Math.abs(r.price_level - v.averagePriceLevel);
    const proximity = Math.max(0, 1 - diff / 3);
    score += proximity * 0.2; weight += 0.2;
    if (proximity >= 0.7) matched.push({ key: "price_proximity", reason: "Same price tier you usually pick.", strength: proximity });
  }
  return weight > 0 ? Math.min(1, score / weight) : 0.5;
}

function scoreBehavior(
  v: TasteVector | null, r: RestaurantInput,
  matched: SignalHit[], stretch: SignalHit[],
): number {
  if (!v) return 0.5;
  let score = 0;
  let weight = 0;

  if (r.format_class) {
    const share = shareOf(v.formatClass, r.format_class);
    score += share * 0.6; weight += 0.6;
    if (share >= 0.3) matched.push({ key: "format_match", reason: `Matches your ${humanize(r.format_class)} habit.`, strength: share });
  }
  if (r.flavor_tags?.length) {
    const overlap = sumShareAcross(v.flavor, r.flavor_tags);
    score += overlap * 0.4; weight += 0.4;
    if (overlap >= 0.25) {
      const top = r.flavor_tags.find((f) => (v.flavor[f] ?? 0) > 0);
      if (top) matched.push({ key: "flavor_match", reason: `${humanize(top)}-forward — your kind of bite.`, strength: overlap });
    }
  }
  return weight > 0 ? Math.min(1, score / weight) : 0.5;
}

function scoreContext(
  v: TasteVector | null, r: RestaurantInput,
  occasion: string, dow: number,
  here: { lat: number; lng: number } | undefined,
  matched: SignalHit[], stretch: SignalHit[],
): number {
  let score = 0;
  let weight = 0;

  // Occasion match (e.g., "late_night" + restaurant has late_night occasion tag)
  if (r.occasion_tags?.length) {
    const occMatch = r.occasion_tags.includes(occasion);
    score += occMatch ? 1 : 0.3;
    weight += 0.5;
    if (occMatch) matched.push({ key: `occasion_${occasion}`, reason: `Right vibe for ${humanize(occasion)}.`, strength: 0.8 });
  }

  // Day-of-week — does the user usually eat on this day? Light signal.
  if (v && v.dowCounts.some((c) => c > 0)) {
    const total = v.dowCounts.reduce((s, n) => s + n, 0);
    const todayShare = v.dowCounts[dow] / total;
    score += Math.min(1, todayShare * 4); // todayShare 0.25 → full credit
    weight += 0.2;
  }

  // Distance — closer is better. >5km is a real penalty.
  if (here && r.latitude != null && r.longitude != null) {
    const km = haversineKm(here, { lat: r.latitude, lng: r.longitude });
    const proximity = Math.max(0, 1 - km / 8); // 0km=1.0, 8km=0
    score += proximity;
    weight += 0.3;
    if (proximity >= 0.85) matched.push({ key: "nearby", reason: "Right around you right now.", strength: proximity });
  }

  if (weight === 0) return 0.5;
  return Math.min(1, score / weight);
}

function scoreNovelty(
  v: TasteVector | null, r: RestaurantInput,
  intent: ScoreContext["intent"], matched: SignalHit[], stretch: SignalHit[],
): number {
  if (!v) return 0.5;
  // Novelty signal = how DIFFERENT this is from user's pattern. For "stretch"
  // intent we reward novelty; for "safe" we reward familiarity; for "neutral"
  // we lightly favor novelty (TikTok-style exploration).
  const subShare = r.cuisine_subregion ? shareOf(v.cuisineSubregion, r.cuisine_subregion) : 0.5;
  const regionShare = r.cuisine_region ? shareOf(v.cuisineRegion, r.cuisine_region) : 0.5;
  const familiarity = (subShare + regionShare) / 2; // 0..1
  const novelty = 1 - familiarity;

  if (intent === "stretch" || intent === "aspirational") {
    if (novelty >= 0.6) stretch.push({ key: "novel_cuisine", reason: "Something new for your Palate.", strength: novelty });
    return novelty;
  }
  if (intent === "safe") return familiarity;
  // Neutral — slight bias toward exploration without punishing safety
  return 0.5 + (novelty - 0.5) * 0.3;
}

function scoreAspirational(
  v: TasteVector | null, r: RestaurantInput,
  matched: SignalHit[], stretch: SignalHit[],
): number {
  if (!v) return 0.5;
  let score = 0;
  let weight = 0;

  if (r.cuisine_region) {
    const aspirationShare = shareOf(v.cuisineRegionAspirational, r.cuisine_region);
    score += aspirationShare;
    weight += 1;
    if (aspirationShare >= 0.2) {
      matched.push({ key: "aspirational_cuisine", reason: `Your wishlist's been leaning ${humanize(r.cuisine_region)}.`, strength: aspirationShare });
    }
  }
  // Bonus: if it's chef-driven or upscale and user has aspiration_tags for it
  const tags = Object.keys(v.aspirationTags);
  if (tags.length > 0 && r.cultural_context === "modernist") {
    score += 0.3; weight += 0.5;
    matched.push({ key: "aspirational_modernist", reason: "Fits your Aspirational Palate.", strength: 0.5 });
  }

  return weight > 0 ? Math.min(1, score / weight) : 0.4;
}

function scoreSocial(r: RestaurantInput, matched: SignalHit[]): number {
  // Capped social proof. A 4.0 → 0.5, 4.5 → 0.75, 4.8 → 0.9. No bonus past 4.9.
  const rating = r.rating ?? 0;
  if (rating === 0) return 0.4;
  const score = Math.min(1, Math.max(0, (rating - 3.5) / 1.4));
  if (rating >= 4.5 && (r.user_rating_count ?? 0) >= 100) {
    matched.push({ key: "well_loved", reason: `Highly rated (${rating.toFixed(1)}★).`, strength: score });
  }
  return score;
}

// ============================================================================
// Helpers
// ============================================================================

function shareOf(map: Record<string, number>, key: string): number {
  const total = Object.values(map).reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  return (map[key] ?? 0) / total;
}

function sumShareAcross(map: Record<string, number>, keys: string[]): number {
  const total = Object.values(map).reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  let sum = 0;
  for (const k of keys) sum += map[k] ?? 0;
  return Math.min(1, sum / total);
}

function inferOccasion(d: Date): string {
  const h = d.getHours();
  const dow = d.getDay();
  if (h < 10) return "breakfast";
  if (h < 14) return (dow === 0 || dow === 6) ? "brunch" : "working_lunch";
  if (h < 17) return "casual_solo";
  if (h < 22) return "group_dinner";
  return "late_night";
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function computeConfidence(v: TasteVector | null, matchedCount: number): MatchConfidence {
  const visits = v?.visitCount ?? 0;
  if (visits >= 12 && matchedCount >= 3) return "high";
  if (visits >= 5 || matchedCount >= 2) return "medium";
  return "low";
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function uniq<T>(arr: T[]): T[] { return [...new Set(arr)]; }

function pct(n: number): number { return Math.round(Math.min(1, Math.max(0, n)) * 100); }
