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
  | "explorer"
  | "cafe_dweller"
  | "comfort_connoisseur"
  | "fast_casual_regular";

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
  },
};
