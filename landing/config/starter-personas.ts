// ============================================================================
// starter-personas.ts — the 5 starter personas the landing-page quiz can land on.
// ----------------------------------------------------------------------------
// The Starter Palate is intentionally simpler than the Weekly Palate (defined
// in mobile/lib/palate-persona.ts which has 9 richer personas). The quiz is
// 3 questions; we don't claim more resolution than we have.
//
// Copy lives here, not in the component. Iterate copy without touching React.
// ============================================================================

import type { Signal } from "./signals";

export type StarterPersonaKey =
  | "convenience_loyalist"
  | "flavor_loyalist"
  | "premium_comfort_loyalist"
  | "practical_variety_seeker"
  | "explorer"
  | "cafe_dweller"
  | "comfort_connoisseur"
  | "fast_casual_regular"
  | "social_diner";

export type StarterPersona = {
  key: StarterPersonaKey;
  label: string;
  tagline: string;
  /** Two-sentence insight rendered on the result card. */
  insight: string;
  /** Brand examples woven into descriptions when relevant. */
  exampleBrands: string[];
  /** Which signals this persona is "about". Drives chip ordering. */
  coreSignals: Signal[];
  /** "You probably…" callout — single line, slightly exposing. */
  probably: string;
  /**
   * Plausible % of quiz-takers who land on this persona. Currently a static
   * estimate based on US eating-pattern intuitions; once we have real
   * `quiz_completed` analytics data we'll compute this server-side and
   * display the live distribution. Sums to ~100 across all 9.
   */
  frequencyPct: number;
};

export const STARTER_PERSONAS: Record<StarterPersonaKey, StarterPersona> = {
  convenience_loyalist: {
    key: "convenience_loyalist",
    label: "The Convenience Loyalist",
    tagline: "Speed and familiarity, no thinking required.",
    insight:
      "You optimize for friction, not flavor. The same order, the same hour, the same trusted spot — that's not a rut, that's a system you've earned.",
    exampleBrands: ["McDonald's", "Subway", "Starbucks"],
    coreSignals: ["no_friction", "routine", "convenience"],
    probably:
      "You probably have the same lunch order Mon-Wed-Fri, and you're not changing it.",
    frequencyPct: 24,
  },

  flavor_loyalist: {
    key: "flavor_loyalist",
    label: "The Flavor Loyalist",
    tagline: "You know what you want, and you go get it.",
    insight:
      "You don't drift toward food — you go *for* it. The repeats in your week aren't laziness; they're a craving you've already done the homework on.",
    exampleBrands: ["Burger King", "Popeyes", "Joe's Pizza"],
    coreSignals: ["flavor_driven", "indulgence", "routine"],
    probably:
      "You probably have a specific dish in mind before you even open the app.",
    frequencyPct: 6,
  },

  premium_comfort_loyalist: {
    key: "premium_comfort_loyalist",
    label: "The Premium Comfort Loyalist",
    tagline: "You'll pay a little more for the same good thing.",
    insight:
      "Not the cheapest option, not the fanciest — the one you trust. You return to the same elevated spots because you've already filtered the noise. Loyal to a feeling, not a price tag.",
    exampleBrands: ["Sweetgreen", "Shake Shack", "Cava"],
    coreSignals: ["premium", "intentional", "routine"],
    probably:
      "You probably know exactly which Sweetgreen has the best playlist.",
    frequencyPct: 4,
  },

  practical_variety_seeker: {
    key: "practical_variety_seeker",
    label: "The Practical Variety Seeker",
    tagline: "You eat a little bit of everything — on purpose.",
    insight:
      "You're not loyal, but you're not random either. Healthy on Tuesday, indulgent on Friday, somewhere new on Sunday — you're picking different modes for different reasons. That's range, not indecision.",
    exampleBrands: ["Sweetgreen", "Joe's Pizza", "the new spot"],
    coreSignals: ["intentional", "novelty", "healthy_ish"],
    probably:
      "You probably hate being asked 'what kind of food do you like?' — the answer is 'depends.'",
    frequencyPct: 8,
  },

  explorer: {
    key: "explorer",
    label: "The Explorer",
    tagline: "Three new spots a week, minimum.",
    insight:
      "You'd rather try and miss than repeat and feel safe. You're collecting places, not patterns — your camera roll is half restaurant signs.",
    exampleBrands: ["the new taco place", "the bakery you haven't tried"],
    coreSignals: ["novelty", "intentional", "flavor_driven"],
    probably:
      "You probably have a saved list of 30 places you still haven't gotten to.",
    frequencyPct: 10,
  },

  cafe_dweller: {
    key: "cafe_dweller",
    label: "The Café Dweller",
    tagline: "Latte before Slack.",
    insight:
      "Five out of seven mornings start the same way. You pick places that feel like extensions of your living room — where the WiFi works and the barista already knows your order.",
    exampleBrands: ["Blue Bottle", "Joe & The Juice", "the local café"],
    coreSignals: ["routine", "intentional", "premium"],
    probably:
      "You probably know your barista's name. They probably know yours.",
    frequencyPct: 12,
  },

  comfort_connoisseur: {
    key: "comfort_connoisseur",
    label: "The Comfort Food Connoisseur",
    tagline: "Pizza is a personality trait.",
    insight:
      "You eat what you actually want, not what looks good on Instagram. The fancy place can wait — tonight it's about the slice, the burger, the bowl that just hits.",
    exampleBrands: ["Joe's Pizza", "Five Guys", "the diner"],
    coreSignals: ["indulgence", "flavor_driven", "routine"],
    probably:
      "You probably have a 'rough day' restaurant. You don't even need a menu.",
    frequencyPct: 16,
  },

  fast_casual_regular: {
    key: "fast_casual_regular",
    label: "The Fast Casual Regular",
    tagline: "Healthy-ish, fast, on the way.",
    insight:
      "You optimize for speed without fully giving up standards. Your Palate likes meals that feel efficient, fresh enough, and easy to justify.",
    exampleBrands: ["Sweetgreen", "Cava", "Chipotle"],
    coreSignals: ["healthy_ish", "convenience", "intentional"],
    probably:
      "You'd probably choose Sweetgreen over cooking, even when you have time.",
    frequencyPct: 18,
  },

  social_diner: {
    key: "social_diner",
    label: "The Social Diner",
    tagline: "Food is the excuse, the table is the point.",
    insight:
      "Your most memorable meals are about the company, not the cuisine. You'd take a mediocre meal with great people over a great meal alone every time.",
    exampleBrands: ["the wine bar", "the group dinner", "wherever the friends are"],
    coreSignals: ["social", "intentional"],
    probably:
      "You probably can't always remember what you ordered — but you remember who you were with.",
    frequencyPct: 2,
  },
};
