// ============================================================================
// Palate Persona Engine
// ----------------------------------------------------------------------------
// Goal: not "what kind of food do you eat?" — "WHO are you, the way you eat?"
//
// Generates a rich, identity-feeling persona from a week of visits:
//   label, tagline, description (with restaurant examples), evidence[],
//   dominantSignals[], recommendationStrategy, confidenceScore.
//
// Reuses raw fetch logic from palate-insights but layers a richer model
// on top via deriveRestaurantProfile. The classifier is rule-based v1
// (priority-ordered) — easy to tune, easy to extend to more personas later.
// ============================================================================

import { supabase } from "./supabase";
import { nearbyRestaurants, type Restaurant } from "./places";
import { deriveRestaurantProfile, flavorSimilarity, type RestaurantProfile } from "./restaurant-profile";
import type { RestaurantRecommendation } from "./palate-insights";

// ============================================================================
// Types
// ============================================================================

export type PersonaKey =
  | "convenience_loyalist"
  | "flavor_loyalist"
  | "premium_comfort_loyalist"
  | "practical_variety_seeker"
  | "explorer"
  | "cafe_dweller"
  | "healthy_optimizer"
  | "comfort_connoisseur"
  | "social_diner";

export type RecommendationStrategy =
  | "convenience" | "flavor_loyal" | "balanced" | "premium" | "explore" | "morning" | "wellness";

export type PalatePersona = {
  key: PersonaKey;
  label: string;
  tagline: string;
  description: string;
  evidence: string[];
  dominantSignals: string[];
  recommendationStrategy: RecommendationStrategy;
  /** 0–1. Based on visit count and how cleanly the dominant signal stacks. */
  confidenceScore: number;
};

// ============================================================================
// Aggregate the week into a context object used by the classifier.
// ============================================================================

type PersonaContext = {
  visitCount: number;
  uniqueCount: number;
  repeatRate: number;
  topRestaurant: { name: string; count: number; profile: RestaurantProfile } | null;
  cuisineCounts: Record<string, number>;
  formatCounts: Record<string, number>;
  intentCounts: Record<string, number>;
  brandTierCounts: Record<string, number>;
  tasteCounts: Record<string, number>;
  behaviorCounts: Record<string, number>;
  highHealthCount: number;
  highComfortCount: number;
  weekStart: string;
  weekEnd: string;
};

function makeContext(weekStart: string, weekEnd: string, visits: WeekVisit[]): PersonaContext {
  const cuisineCounts: Record<string, number> = {};
  const formatCounts: Record<string, number> = {};
  const intentCounts: Record<string, number> = {};
  const brandTierCounts: Record<string, number> = {};
  const tasteCounts: Record<string, number> = {};
  const behaviorCounts: Record<string, number> = {};
  const restaurantCounts = new Map<string, { name: string; count: number; profile: RestaurantProfile }>();

  let highHealthCount = 0;
  let highComfortCount = 0;

  for (const v of visits) {
    if (!v.profile) continue;
    const p = v.profile;

    // restaurant count keyed by name (chains roll up naturally)
    const key = p.name.toLowerCase();
    const existing = restaurantCounts.get(key);
    if (existing) existing.count++;
    else restaurantCounts.set(key, { name: p.name, count: 1, profile: p });

    if (p.cuisineTypes[0]) cuisineCounts[p.cuisineTypes[0]] = (cuisineCounts[p.cuisineTypes[0]] ?? 0) + 1;
    formatCounts[p.format] = (formatCounts[p.format] ?? 0) + 1;
    intentCounts[p.decisionIntent] = (intentCounts[p.decisionIntent] ?? 0) + 1;
    brandTierCounts[p.brandTier] = (brandTierCounts[p.brandTier] ?? 0) + 1;
    for (const t of p.tasteTags) tasteCounts[t] = (tasteCounts[t] ?? 0) + 1;
    for (const b of p.behaviorTags) behaviorCounts[b] = (behaviorCounts[b] ?? 0) + 1;
    if (p.healthSignal === "high") highHealthCount++;
    if (p.comfortSignal === "high") highComfortCount++;
  }

  const topRestaurant = [...restaurantCounts.values()].sort((a, b) => b.count - a.count)[0] ?? null;
  const visitCount = visits.length;
  const uniqueCount = restaurantCounts.size;
  const repeats = visitCount - uniqueCount;
  const repeatRate = visitCount > 0 ? repeats / visitCount : 0;

  return {
    visitCount, uniqueCount, repeatRate, topRestaurant,
    cuisineCounts, formatCounts, intentCounts, brandTierCounts,
    tasteCounts, behaviorCounts, highHealthCount, highComfortCount,
    weekStart, weekEnd,
  };
}

// ============================================================================
// Persona definitions — ordered by priority. First match wins.
// Each describer returns a sentence that names the user's actual restaurants
// so the result feels specific, not generic.
// ============================================================================

type PersonaDef = {
  key: PersonaKey;
  label: string;
  tagline: string;
  recommendationStrategy: RecommendationStrategy;
  matches: (ctx: PersonaContext) => boolean;
  describe: (ctx: PersonaContext) => string;
  signals: (ctx: PersonaContext) => string[];
};

const PERSONAS: PersonaDef[] = [
  // 1. >=3 visits to one chain that is no_friction → Convenience Loyalist
  {
    key: "convenience_loyalist",
    label: "The Convenience Loyalist",
    tagline: "Speed and familiarity, no thinking required.",
    recommendationStrategy: "convenience",
    matches: (c) =>
      !!c.topRestaurant && c.topRestaurant.count >= 3 &&
      c.topRestaurant.profile.decisionIntent === "no_friction",
    describe: (c) => {
      const r = c.topRestaurant!;
      return `You leaned into consistency and convenience. You chose ${r.name} ${r.count} times this week — that wasn't random. ${capFirst(r.profile.flavorSignature)}. You optimized for friction, and there is nothing wrong with that.`;
    },
    signals: (c) => signalList(c, ["routine", "convenient", "low_variety"]),
  },

  // 2. >=3 visits to one place that is preference_driven → Flavor Loyalist
  {
    key: "flavor_loyalist",
    label: "The Flavor Loyalist",
    tagline: "You know what you want, and you go get it.",
    recommendationStrategy: "flavor_loyal",
    matches: (c) =>
      !!c.topRestaurant && c.topRestaurant.count >= 3 &&
      c.topRestaurant.profile.decisionIntent === "preference_driven",
    describe: (c) => {
      const r = c.topRestaurant!;
      return `You showed a preference for ${r.profile.flavorSignature}. ${r.count} visits to ${r.name} this week — this wasn't convenience, you had a specific craving and you fed it.`;
    },
    signals: (c) => signalList(c, ["craving_driven", "comfort_food", "low_variety"]),
  },

  // 3. Premium fast casual repetition → Premium Comfort Loyalist
  {
    key: "premium_comfort_loyalist",
    label: "The Premium Comfort Loyalist",
    tagline: "You'll pay a little more for the same good thing.",
    recommendationStrategy: "premium",
    matches: (c) =>
      !!c.topRestaurant && c.topRestaurant.count >= 2 &&
      c.topRestaurant.profile.brandTier === "premium_fast_casual",
    describe: (c) => {
      const r = c.topRestaurant!;
      return `You returned to ${r.name} ${r.count} times this week. Not the cheapest option — but the one you trust. ${capFirst(r.profile.flavorSignature)}. You're loyal to a feeling, not a price.`;
    },
    signals: (c) => signalList(c, ["elevated", "routine", "healthy_leaning"]),
  },

  // 4. ≥70% intentional/healthy choices, 3+ visits → Healthy Optimizer
  {
    key: "healthy_optimizer",
    label: "The Healthy Optimizer",
    tagline: "Fast, intentional, and somehow still on track.",
    recommendationStrategy: "wellness",
    matches: (c) =>
      c.visitCount >= 3 && (c.highHealthCount / c.visitCount) >= 0.6,
    describe: (c) => {
      const examples = topNames(c, 2);
      return `You optimized for speed without giving up the plot. ${c.highHealthCount} of your ${c.visitCount} meals leaned bright, fresh, intentional${examples ? ` — ${examples}` : ""}. You'd choose a bowl over cooking, even when you have time.`;
    },
    signals: (c) => signalList(c, ["healthy_leaning", "intentional", "elevated"]),
  },

  // 5. >50% café/morning visits → Café Dweller
  {
    key: "cafe_dweller",
    label: "The Café Dweller",
    tagline: "Latte before Slack.",
    recommendationStrategy: "morning",
    matches: (c) => c.visitCount >= 3 && (c.formatCounts["cafe"] ?? 0) / c.visitCount > 0.5,
    describe: (c) => {
      const top = c.topRestaurant ? c.topRestaurant.name : "your café";
      return `Five out of seven mornings start the same way. You went to ${top} more than anywhere else this week — the barista probably already knows your order.`;
    },
    signals: (c) => signalList(c, ["routine", "morning", "café"]),
  },

  // 6. >=5 unique restaurants, low repeat rate → Explorer
  {
    key: "explorer",
    label: "The Explorer",
    tagline: "Three new spots a week, minimum.",
    recommendationStrategy: "explore",
    matches: (c) => c.uniqueCount >= 5 && c.repeatRate <= 0.2,
    describe: (c) => {
      const cuisines = Object.keys(c.cuisineCounts).slice(0, 3).join(", ");
      return `You barely repeated anywhere. ${c.uniqueCount} different restaurants in ${c.visitCount} meals${cuisines ? ` — across ${cuisines}` : ""}. You're collecting places, not patterns.`;
    },
    signals: (c) => signalList(c, ["exploratory", "high_variety", "novelty_seeking"]),
  },

  // 7. Mix of healthy + indulgent + convenient (across the visit set) → Practical Variety Seeker
  {
    key: "practical_variety_seeker",
    label: "The Practical Variety Seeker",
    tagline: "You eat a little bit of everything — on purpose.",
    recommendationStrategy: "balanced",
    matches: (c) => {
      const hasHealthy = c.highHealthCount >= 1;
      const hasIndulgent = (c.behaviorCounts["indulgent"] ?? 0) >= 1;
      const hasConvenient = (c.behaviorCounts["convenient"] ?? 0) >= 1;
      return c.visitCount >= 3 && hasHealthy && hasIndulgent && hasConvenient;
    },
    describe: (c) => {
      const examples = topNames(c, 3);
      return `You balanced the week: bright and fresh on one day, indulgent on another, fast and easy when you needed it${examples ? ` — moving between ${examples}` : ""}. You're choosing different modes on purpose.`;
    },
    signals: (c) => signalList(c, ["balanced", "intentional", "high_variety"]),
  },

  // 8. Bar-heavy / late-night / social-leaning → Social Diner
  {
    key: "social_diner",
    label: "The Social Diner",
    tagline: "Food is the excuse, the table is the point.",
    recommendationStrategy: "balanced",
    matches: (c) => c.visitCount >= 2 && ((c.formatCounts["bar"] ?? 0) >= 1 || (c.behaviorCounts["social"] ?? 0) >= 2),
    describe: (c) => {
      const examples = topNames(c, 2);
      return `Your week skewed social${examples ? ` — ${examples}` : ""}. Bars, group-friendly tables, places designed for hanging out. The meal is the medium, the people are the message.`;
    },
    signals: (c) => signalList(c, ["social", "shareable", "late-night"]),
  },

  // 9. Default fallback — Comfort Connoisseur (everyone has one)
  {
    key: "comfort_connoisseur",
    label: "The Comfort Food Connoisseur",
    tagline: "Pizza is a personality trait.",
    recommendationStrategy: "flavor_loyal",
    matches: (c) => c.visitCount >= 1,
    describe: (c) => {
      const examples = topNames(c, 2);
      const cuisine = topKey(c.cuisineCounts) ?? "the things you actually crave";
      return `Your week leaned toward ${cuisine}${examples ? ` — ${examples}` : ""}. You eat what you actually want, and we love that for you.`;
    },
    signals: (c) => signalList(c, ["comfort_food", "indulgent"]),
  },
];

// ============================================================================
// Public API
// ============================================================================

type WeekVisit = { visited_at: string; profile: RestaurantProfile | null };

/**
 * Generate the rich weekly Palate persona. Returns null only if there are
 * zero visits. For 1–2 visits we still return a low-confidence persona —
 * the WeeklyPalateInsights component should also show the "warming up"
 * caveat when confidenceScore < 0.4.
 */
export async function generateWeeklyPalatePersona(
  weekStart: string,
  weekEnd: string,
): Promise<PalatePersona | null> {
  const visits = await loadWeekVisits(weekStart, weekEnd);

  // Fallback: no visits yet → use the Starter Palate quiz result if we have it.
  // Lets Wrapped + Recommendations stay alive on day one.
  if (!visits.length) {
    return await starterPalateFallback();
  }

  const ctx = makeContext(weekStart, weekEnd, visits);
  const def = PERSONAS.find((d) => d.matches(ctx)) ?? PERSONAS[PERSONAS.length - 1];

  const description = def.describe(ctx);
  const evidence = buildEvidence(ctx);
  const dominantSignals = def.signals(ctx);
  const confidenceScore = computeConfidence(ctx, def);

  return {
    key: def.key,
    label: def.label,
    tagline: def.tagline,
    description,
    evidence,
    dominantSignals,
    recommendationStrategy: def.recommendationStrategy,
    confidenceScore,
  };
}

async function starterPalateFallback(): Promise<PalatePersona | null> {
  const { getQuizPersona } = await import("./profile");
  const { STARTER_PERSONAS } = await import("./starter-quiz");
  const { persona, chips } = await getQuizPersona();
  if (!persona) return null;

  const sp = (STARTER_PERSONAS as any)[persona];
  if (!sp) return null;

  // Map starter persona to a recommendation strategy used downstream.
  const strategyMap: Record<string, RecommendationStrategy> = {
    convenience_loyalist:     "convenience",
    flavor_loyalist:          "flavor_loyal",
    premium_comfort_loyalist: "premium",
    practical_variety_seeker: "balanced",
    explorer:                 "explore",
    cafe_dweller:             "morning",
    comfort_connoisseur:      "flavor_loyal",
    fast_casual_regular:      "wellness",
    social_diner:             "balanced",
  };

  return {
    key: (persona as PersonaKey),
    label: sp.label,
    tagline: sp.tagline,
    description: sp.insight,
    evidence: chips.length ? chips : sp.insights.slice(0, 2),
    dominantSignals: [],
    recommendationStrategy: strategyMap[persona] ?? "balanced",
    confidenceScore: 0.2, // low — this is just a starter
  };
}

/** Persona-driven recs. Strategy decides "give me more of the same" vs "stretch me". */
export async function getPersonaRecommendations(
  persona: PalatePersona,
  weekStart: string,
  weekEnd: string,
  fallbackAnchor?: { lat: number; lng: number },
): Promise<{ similar: RestaurantRecommendation[]; stretch: RestaurantRecommendation | null }> {
  const visits = await loadWeekVisits(weekStart, weekEnd);
  const anchor = await resolveAnchor(visits, fallbackAnchor);
  if (!anchor) return { similar: [], stretch: null };

  // Wider radius for explorers, tighter for routine-heavy personas.
  const radius =
    persona.recommendationStrategy === "explore" ? 1500 :
    persona.recommendationStrategy === "convenience" ? 600 : 900;

  const candidates = await nearbyRestaurants(anchor.lat, anchor.lng, radius);
  const visitedNames = new Set(visits.map((v) => v.profile?.name.toLowerCase() ?? "").filter(Boolean));

  const enriched = candidates
    .filter((c) => !visitedNames.has(c.name.toLowerCase()))
    .map((c) => ({ place: c, profile: deriveRestaurantProfile(c) }));

  const topProfile = visits[0]?.profile ?? null;
  const ranked = enriched.map((e) => {
    let score = 0;
    if (topProfile) score += flavorSimilarity(topProfile, e.profile);
    if (matchesStrategy(persona.recommendationStrategy, e.profile)) score += 4;
    if (e.place.rating != null) score += Math.min(e.place.rating - 3.5, 1.5);
    return { ...e, score };
  });

  const similarRanked = ranked.filter((e) => e.score > 0).sort((a, b) => b.score - a.score);
  const similar = similarRanked.slice(0, 3).map((e) => toRec(e.place, e.profile, similarReason(persona, e.profile)));

  // Stretch: a deliberate left turn — different intent + a strong signal.
  const stretchCandidate = enriched
    .map((e) => ({
      ...e,
      stretchScore:
        (topProfile && e.profile.decisionIntent !== topProfile.decisionIntent ? 3 : 0) +
        (topProfile && e.profile.cuisineTypes[0] !== topProfile.cuisineTypes[0] ? 2 : 0) +
        (e.place.rating != null && e.place.rating >= 4.2 ? 2 : 0),
    }))
    .sort((a, b) => b.stretchScore - a.stretchScore)[0];

  const stretch = stretchCandidate
    ? toRec(stretchCandidate.place, stretchCandidate.profile, stretchReason(persona, stretchCandidate.profile))
    : null;

  return { similar, stretch };
}

// ============================================================================
// Helpers
// ============================================================================

async function loadWeekVisits(weekStart: string, weekEnd: string): Promise<WeekVisit[]> {
  const startISO = new Date(`${weekStart}T00:00:00Z`).toISOString();
  const endISO = new Date(`${weekEnd}T23:59:59Z`).toISOString();
  const { data, error } = await supabase
    .from("visits")
    .select(`
      visited_at,
      restaurant:restaurants (
        id, google_place_id, name, chain_name, primary_type,
        cuisine_type, neighborhood, tags, price_level, rating,
        address, latitude, longitude
      )
    `)
    .gte("visited_at", startISO)
    .lte("visited_at", endISO)
    .order("visited_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{ visited_at: string; restaurant: Restaurant | null }>)
    .map((row) => ({
      visited_at: row.visited_at,
      profile: row.restaurant ? deriveRestaurantProfile(row.restaurant) : null,
    }));
}

async function resolveAnchor(
  visits: WeekVisit[],
  fallback?: { lat: number; lng: number },
): Promise<{ lat: number; lng: number } | null> {
  // Lat/lng of first visit's restaurant (we'd need to re-fetch — skip and use fallback chain)
  if (fallback) return fallback;
  const { data } = await supabase
    .from("location_events")
    .select("latitude, longitude")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data && data.latitude != null && data.longitude != null) {
    return { lat: data.latitude as number, lng: data.longitude as number };
  }
  return null;
}

function buildEvidence(c: PersonaContext): string[] {
  const evidence: string[] = [];
  if (c.topRestaurant && c.topRestaurant.count >= 2) {
    evidence.push(`${c.topRestaurant.count} visits to ${c.topRestaurant.name}`);
  }
  if (c.repeatRate >= 0.5) evidence.push("High repeat rate");
  else if (c.uniqueCount >= 5) evidence.push("High variety");
  const intent = topKey(c.intentCounts);
  if (intent) evidence.push(`Mostly ${intent.replace(/_/g, " ")} choices`);
  if (c.highHealthCount >= 1 && c.highComfortCount >= 1) evidence.push("Mix of healthy and comfort choices");
  const taste = topKey(c.tasteCounts);
  if (taste) evidence.push(`Dominant flavor: ${taste}`);
  return evidence;
}

function computeConfidence(c: PersonaContext, def: PersonaDef): number {
  // Floor of 0.3 (we always return *something*), boosted by visit count and signal clarity.
  let score = 0.3 + Math.min(c.visitCount / 10, 0.4);
  // Tight winning signal raises confidence
  if (c.topRestaurant && c.topRestaurant.count >= 3) score += 0.2;
  if (c.uniqueCount >= 5 && c.repeatRate <= 0.2) score += 0.15;
  // Fallback persona is a low-confidence catch-all
  if (def.key === "comfort_connoisseur" && c.visitCount < 3) score = Math.min(score, 0.4);
  return Math.min(score, 1);
}

function matchesStrategy(strategy: RecommendationStrategy, p: RestaurantProfile): boolean {
  switch (strategy) {
    case "convenience": return p.decisionIntent === "no_friction" || p.format === "quick_service";
    case "flavor_loyal": return p.decisionIntent === "preference_driven";
    case "premium":     return p.brandTier === "premium_fast_casual" || p.brandTier === "upscale";
    case "explore":     return p.noveltySignal !== "low";
    case "morning":     return p.format === "cafe";
    case "wellness":    return p.healthSignal === "high";
    case "balanced":    return true;
  }
}

function similarReason(persona: PalatePersona, p: RestaurantProfile): string {
  switch (persona.recommendationStrategy) {
    case "convenience": return "Fast and reliable, like the spots you keep going back to";
    case "flavor_loyal": return `Same craving lane: ${p.flavorSignature}`;
    case "premium":     return "Same elevated lane as your usual";
    case "explore":     return "Different cuisine, similar vibe — worth a try";
    case "morning":     return "Café energy, like your usual mornings";
    case "wellness":    return "Bright and intentional — fits how you eat";
    case "balanced":    return `${p.flavorSignature}, fits your week`;
  }
}

function stretchReason(persona: PalatePersona, p: RestaurantProfile): string {
  return `Different lane: ${p.flavorSignature}. Worth a left turn.`;
}

function toRec(place: Restaurant, profile: RestaurantProfile, reason: string): RestaurantRecommendation {
  return {
    google_place_id: place.google_place_id,
    name: place.name,
    cuisine: profile.cuisineTypes[0] ?? null,
    neighborhood: place.neighborhood ?? null,
    reason,
    price_level: place.price_level ?? null,
    rating: place.rating ?? null,
  };
}

function topNames(c: PersonaContext, n: number): string {
  return Object.entries(c.cuisineCounts).length === 0
    ? ""
    : (c.topRestaurant ? c.topRestaurant.name : "");
}

function topKey(counts: Record<string, number>): string | null {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? null;
}

function signalList(_: PersonaContext, signals: string[]): string[] { return signals; }
function capFirst(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : s; }
