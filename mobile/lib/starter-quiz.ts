// ============================================================================
// starter-quiz.ts — the persona VOCABULARY. The quiz itself is gone.
// ----------------------------------------------------------------------------
// The 60-second starter quiz was removed: it asked five hypotheticals, and its
// own author answered it honestly and got "The Convenience Loyalist" —
// McDonald's, Subway, Starbucks — having picked a new spot over a familiar
// one. It was not tunable either, because the questions confounded independent
// axes and summed a weekday answer with a weekend one.
//
// New accounts are now seeded from the population instead (population-prior.ts
// and migration 0161), which asks the database what people actually eat rather
// than asking a stranger to predict themselves.
//
// What survives here is only the persona keys and labels. Accounts that took
// the quiz still carry a quiz_persona, and it still feeds their prior and their
// profile display — deleting the vocabulary would turn a stored value into an
// unrenderable string for every one of them.
// ============================================================================

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

export type PersonaWeights = Partial<Record<StarterPersonaKey, number>>;

export type QuizOption = {
  emoji: string;
  text: string;
  personaWeights: PersonaWeights;
  chip: string;
  feedback: string;
};

export type QuizQuestion = {
  id: string;
  prompt: string;
  options: QuizOption[];
};

// ----------------------------------------------------------------------------
// Personas — copy + 3 brand recs + 1 stretch rec per persona.
// ----------------------------------------------------------------------------

export type StarterPersona = {
  key: StarterPersonaKey;
  label: string;
  tagline: string;
  insight: string;
  insights: string[]; // 2-3 short bullet insights
  recs: string[]; // 3 brand-name "your kind of place" examples
  stretch: { name: string; reason: string };
};

export const STARTER_PERSONAS: Record<StarterPersonaKey, StarterPersona> = {
  convenience_loyalist: {
    key: "convenience_loyalist",
    label: "The Convenience Loyalist",
    tagline: "Speed and familiarity win.",
    insight: "Routine works for you. Same spots, same order, less friction.",
    insights: [
      "Routine is your edge",
      "You repeat what works",
    ],
    recs: ["McDonald's", "Subway", "Starbucks"],
    stretch: { name: "Chipotle", reason: "Same convenience, a level up." },
  },
  flavor_loyalist: {
    key: "flavor_loyalist",
    label: "The Flavor Loyalist",
    tagline: "You know what you want.",
    insight: "Your picks start from a specific craving, not a search.",
    insights: [
      "Cravings drive your choices",
      "You'll travel for the right bite",
    ],
    recs: ["Burger King", "Popeyes", "Joe's Pizza"],
    stretch: { name: "Roberta's", reason: "Familiar craving, sharper version." },
  },
  premium_comfort_loyalist: {
    key: "premium_comfort_loyalist",
    label: "The Premium Comfort Loyalist",
    tagline: "Pays a little more for the right thing.",
    insight: "Loyal to feel, not price. You return to what fits.",
    insights: [
      "Quality before price",
      "Same trusted spots, better quality",
    ],
    recs: ["Sweetgreen", "Shake Shack", "Cava"],
    stretch: { name: "Tatte Bakery", reason: "Same energy, broader menu." },
  },
  practical_variety_seeker: {
    key: "practical_variety_seeker",
    label: "The Practical Variety Seeker",
    tagline: "A little of everything, on purpose.",
    insight: "Different days, different modes. You read context well.",
    insights: [
      "Range, not indecision",
      "Healthy weekday, indulgent weekend",
    ],
    recs: ["Sweetgreen", "Joe's Pizza", "the new ramen spot"],
    stretch: { name: "Xi'an Famous Foods", reason: "A different lane, your speed." },
  },
  explorer: {
    key: "explorer",
    label: "The Explorer",
    tagline: "New beats familiar.",
    insight: "Trying wins over repeating. You collect places.",
    insights: [
      "Running list of places to try",
      "Repeats feel like missed chances",
    ],
    recs: ["the new taco place", "the bakery you haven't tried", "the pop-up your friend mentioned"],
    stretch: { name: "Atomix", reason: "The kind of meal you'll remember." },
  },
  cafe_dweller: {
    key: "cafe_dweller",
    label: "The Café Dweller",
    tagline: "Latte before Slack.",
    insight: "Most mornings start the same way, on purpose.",
    insights: [
      "WiFi matters as much as the menu",
      "Regular café is your second living room",
    ],
    recs: ["Blue Bottle", "Joe & The Juice", "the local coffee shop"],
    stretch: { name: "Devoción", reason: "Same morning, a step up." },
  },
  comfort_connoisseur: {
    key: "comfort_connoisseur",
    label: "The Comfort Food Connoisseur",
    tagline: "Eats what actually sounds good.",
    insight: "Comfort over photo-worthy. Hits over hype.",
    insights: [
      "Has a 'rough day' restaurant",
      "Doesn't apologize for the order",
    ],
    recs: ["Joe's Pizza", "Five Guys", "the diner"],
    stretch: { name: "Lucali", reason: "Same comfort, level up." },
  },
  fast_casual_regular: {
    key: "fast_casual_regular",
    label: "The Fast Casual Regular",
    tagline: "Healthy-ish, fast, on the way.",
    insight: "Speed and standards, no trade-off.",
    insights: [
      "Quick service makes sense for your week",
      "Fast doesn't mean compromised",
    ],
    recs: ["Sweetgreen", "Cava", "Chipotle"],
    stretch: { name: "Dig Inn", reason: "Same lane, more flavor." },
  },
  social_diner: {
    key: "social_diner",
    label: "The Social Diner",
    tagline: "The table matters more than the menu.",
    insight: "Best meals are about the people, not the cuisine.",
    insights: [
      "Remembers who you were with",
      "Long dinners over quick ones",
    ],
    recs: ["the wine bar", "the group dinner spot", "wherever the friends are"],
    stretch: { name: "Lilia", reason: "Built for a small group." },
  },
};

// ----------------------------------------------------------------------------
// Scoring
// ----------------------------------------------------------------------------




