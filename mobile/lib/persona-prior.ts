// ============================================================================
// persona-prior.ts — seed a cold-start taste vector from the onboarding quiz.
// ----------------------------------------------------------------------------
// The 60-second starter quiz produces a `quiz_persona`, but until now that
// signal never reached the recommender — new users got a distance/rating
// ranker until they logged 3+ visits. This maps each persona to a small set
// of seed weights (format / price / occasion / flavor / region) that we blend
// into the taste vector ONLY while real visit data is sparse. The weight is
// deliberately small so a handful of real visits quickly outweigh the prior.
// ============================================================================

import type { StarterPersonaKey } from "./starter-quiz";
import type { TasteVector, WeightMap } from "./taste-vector";

type PriorSeed = {
  formatClass?: string[];
  priceTier?: string[]; // "1".."4"
  occasion?: string[];
  flavor?: string[];
  cuisineRegion?: string[];
};

const PERSONA_PRIORS: Record<StarterPersonaKey, PriorSeed> = {
  convenience_loyalist: {
    formatClass: ["quick_service", "fast_casual"],
    priceTier: ["1", "2"],
    occasion: ["working_lunch", "casual_solo"],
  },
  flavor_loyalist: {
    formatClass: ["casual_dining"],
    flavor: ["rich", "spicy"],
    occasion: ["casual_solo"],
  },
  premium_comfort_loyalist: {
    formatClass: ["casual_dining", "fine_dining"],
    priceTier: ["3"],
    occasion: ["date_night"],
  },
  practical_variety_seeker: {
    formatClass: ["fast_casual"],
    priceTier: ["2"],
    occasion: ["working_lunch", "group_dinner"],
  },
  explorer: {
    formatClass: ["casual_dining"],
    occasion: ["group_dinner"],
    cuisineRegion: ["east_asian", "latin_american", "middle_eastern"],
  },
  cafe_dweller: {
    formatClass: ["café"],
    occasion: ["breakfast", "working_lunch"],
    flavor: ["sweet"],
  },
  comfort_connoisseur: {
    formatClass: ["casual_dining"],
    flavor: ["rich", "savory"],
    occasion: ["casual_solo"],
  },
  fast_casual_regular: {
    formatClass: ["fast_casual", "quick_service"],
    priceTier: ["1", "2"],
    flavor: ["fresh", "light"],
  },
  social_diner: {
    formatClass: ["casual_dining", "wine_bar"],
    priceTier: ["2", "3"],
    occasion: ["group_dinner", "date_night"],
  },
};

// Weight added per seeded key. Small on purpose — ~1-2 real visits should
// already dominate the prior once they land.
const PRIOR_WEIGHT = 1.0;

/** Mutates `v` in place, blending the persona's seed weights into its maps. */
export function applyPersonaPrior(v: TasteVector, persona: StarterPersonaKey): void {
  const seed = PERSONA_PRIORS[persona];
  if (!seed) return;
  const add = (map: WeightMap, keys?: string[]) => {
    for (const k of keys ?? []) map[k] = (map[k] ?? 0) + PRIOR_WEIGHT;
  };
  add(v.formatClass, seed.formatClass);
  add(v.priceTier, seed.priceTier);
  add(v.occasion, seed.occasion);
  add(v.flavor, seed.flavor);
  add(v.cuisineRegion, seed.cuisineRegion);
}
