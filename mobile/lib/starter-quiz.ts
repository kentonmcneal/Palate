// ============================================================================
// starter-quiz.ts — 5-question Starter Palate quiz, mobile copy of the web
// version. Multi-axis weighted scoring → one of 9 starter personas.
// Results land in profiles.quiz_persona / quiz_chips for use as fallback
// when no visits exist yet.
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

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: "tuesday_night",
    prompt: "It's a Tuesday at 7:30pm. You haven't eaten yet.",
    options: [
      { emoji: "🥡", text: "I'm not deciding. I'm getting the thing that always hits.",
        personaWeights: { convenience_loyalist: 3, flavor_loyalist: 1 },
        chip: "Low decision effort",
        feedback: "You lean routine over exploration." },
      { emoji: "🌮", text: "Walking ten minutes for the place I've been meaning to try.",
        personaWeights: { explorer: 3, practical_variety_seeker: 1 },
        chip: "Try-new energy",
        feedback: "You'd rather try than repeat." },
      { emoji: "🥗", text: "Something healthy-ish, fast, and on the way.",
        personaWeights: { fast_casual_regular: 3, practical_variety_seeker: 1 },
        chip: "Healthy-ish choices",
        feedback: "Convenience, but with intent." },
      { emoji: "🍔", text: "I had a long day. I'm getting the thing I keep thinking about.",
        personaWeights: { comfort_connoisseur: 3, flavor_loyalist: 2 },
        chip: "Comfort over optics",
        feedback: "Tonight, comfort wins. No notes." },
    ],
  },
  {
    id: "saturday_afternoon",
    prompt: "Saturday afternoon, hungry and uncommitted.",
    options: [
      { emoji: "☕", text: "Same café. Same order. No surprises.",
        personaWeights: { cafe_dweller: 3, convenience_loyalist: 1 },
        chip: "Coffee shop loyalty",
        feedback: "Same place, same order. Rhythm." },
      { emoji: "📸", text: "Somewhere I'd actually want to talk about. The vibe matters.",
        personaWeights: { explorer: 2, premium_comfort_loyalist: 2, social_diner: 1 },
        chip: "Vibe over speed",
        feedback: "You're picking for the story." },
      { emoji: "⚡", text: "Whatever's open and fast. I'm not making decisions today.",
        personaWeights: { convenience_loyalist: 3, fast_casual_regular: 1 },
        chip: "Convenience matters",
        feedback: "Speed is the priority." },
      { emoji: "🥑", text: "Something fresh. I've been eating heavy all week.",
        personaWeights: { fast_casual_regular: 3, practical_variety_seeker: 1 },
        chip: "Bowls over brunch",
        feedback: "On track. Even on a Saturday." },
    ],
  },
  {
    id: "best_meal",
    prompt: "A friend asks: \"best meal you had this month?\"",
    options: [
      { emoji: "🔥", text: "Honestly? That one indulgent thing I can't stop thinking about.",
        personaWeights: { comfort_connoisseur: 3, flavor_loyalist: 2 },
        chip: "Indulgent and proud",
        feedback: "Comfort food sticks." },
      { emoji: "🆕", text: "A new spot a friend dragged me to. Never would have gone otherwise.",
        personaWeights: { explorer: 3, social_diner: 2 },
        chip: "New > known",
        feedback: "Some best meals happen because someone else picked." },
      { emoji: "🥣", text: "The exact bowl I get every Thursday. Don't judge.",
        personaWeights: { convenience_loyalist: 2, fast_casual_regular: 2 },
        chip: "Repeat-order energy",
        feedback: "Loyalty is its own kind of love." },
      { emoji: "🥐", text: "Long brunch with great coffee, somewhere quiet.",
        personaWeights: { cafe_dweller: 3, premium_comfort_loyalist: 1 },
        chip: "Slow Saturday energy",
        feedback: "The mood is the point." },
    ],
  },
  {
    id: "the_bill",
    prompt: "When the bill comes, you…",
    options: [
      { emoji: "🙋", text: "I split it. Money stuff is a vibe-killer.",
        personaWeights: { social_diner: 3, comfort_connoisseur: 1 },
        chip: "Tab is the table's",
        feedback: "Food is the excuse, the table is the point." },
      { emoji: "💸", text: "I check the math. Always.",
        personaWeights: { convenience_loyalist: 2, practical_variety_seeker: 1 },
        chip: "Value-aware",
        feedback: "You know exactly where the money goes." },
      { emoji: "✨", text: "I don't really notice. Good food is worth it.",
        personaWeights: { premium_comfort_loyalist: 3, flavor_loyalist: 2 },
        chip: "Quality over price",
        feedback: "You'll pay for what you actually want." },
      { emoji: "🍳", text: "I'd rather have spent that on groceries.",
        personaWeights: { fast_casual_regular: 2, cafe_dweller: 1, practical_variety_seeker: 1 },
        chip: "Cook-at-home leanings",
        feedback: "Eating out — but the math is in your head." },
    ],
  },
  {
    id: "memorable_meal",
    prompt: "Your last memorable meal was about…",
    options: [
      { emoji: "🌶️", text: "The food itself. A flavor I can't stop thinking about.",
        personaWeights: { flavor_loyalist: 3, comfort_connoisseur: 1 },
        chip: "Flavor-first",
        feedback: "You don't forget a great bite." },
      { emoji: "👯", text: "The people I was with. Honestly can't remember what I ordered.",
        personaWeights: { social_diner: 3, explorer: 1 },
        chip: "People > plate",
        feedback: "Food is the canvas. The company is the painting." },
      { emoji: "💯", text: "Trying something I'd never had before. New cuisine, new dish.",
        personaWeights: { explorer: 3, premium_comfort_loyalist: 1 },
        chip: "First-time energy",
        feedback: "Novelty is the meal you remember." },
      { emoji: "🛋️", text: "Just relaxing. Comfort food, no pressure, my favorite spot.",
        personaWeights: { comfort_connoisseur: 2, cafe_dweller: 2, convenience_loyalist: 1 },
        chip: "Comfort = memory",
        feedback: "Familiar is its own kind of special." },
    ],
  },
];

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
    tagline: "Speed and familiarity, no thinking required.",
    insight:
      "You optimize for friction, not flavor. Same order, same hour, same trusted spot.",
    insights: [
      "Routine is your edge — you've already done the homework",
      "You'd rather repeat a 9/10 than gamble on a maybe-10",
      "Most of your week is on autopilot, by design",
    ],
    recs: ["McDonald's", "Subway", "Starbucks"],
    stretch: { name: "Chipotle", reason: "Same speed, slightly elevated — try it on a Tuesday" },
  },
  flavor_loyalist: {
    key: "flavor_loyalist",
    label: "The Flavor Loyalist",
    tagline: "You know what you want, and you go get it.",
    insight: "You don't drift toward food — you go for it.",
    insights: [
      "Specific cravings drive your choices, not convenience",
      "You'll cross town for the right bite",
      "Repeats aren't laziness — they're a verified hit",
    ],
    recs: ["Burger King", "Popeyes", "Joe's Pizza"],
    stretch: { name: "Roberta's", reason: "If you love a great slice, level up here" },
  },
  premium_comfort_loyalist: {
    key: "premium_comfort_loyalist",
    label: "The Premium Comfort Loyalist",
    tagline: "You'll pay a little more for the same good thing.",
    insight: "Loyal to a feeling, not a price tag.",
    insights: [
      "You filter for quality, then return on repeat",
      "Not the cheapest, not the fanciest — the right one",
      "You know which location of your favorite chain to pick",
    ],
    recs: ["Sweetgreen", "Shake Shack", "Cava"],
    stretch: { name: "Tatte Bakery", reason: "Same energy, broader menu — start with brunch" },
  },
  practical_variety_seeker: {
    key: "practical_variety_seeker",
    label: "The Practical Variety Seeker",
    tagline: "You eat a little of everything — on purpose.",
    insight: "You're not loyal, but you're not random either.",
    insights: [
      "Different modes for different reasons — that's range, not indecision",
      "Healthy Tuesday, indulgent Friday, new spot Sunday",
      '"What kind of food do you like?" → "Depends."',
    ],
    recs: ["Sweetgreen", "Joe's Pizza", "the new ramen spot"],
    stretch: { name: "Xi'an Famous Foods", reason: "Bold and different — perfect Sunday detour" },
  },
  explorer: {
    key: "explorer",
    label: "The Explorer",
    tagline: "Three new spots a week, minimum.",
    insight: "You'd rather try and miss than repeat and feel safe.",
    insights: [
      "Your camera roll is half restaurant signs",
      "You collect places, not patterns",
      "Repeat visits feel like a missed opportunity",
    ],
    recs: ["the new taco place", "the bakery you haven't tried", "the pop-up your friend mentioned"],
    stretch: { name: "Atomix", reason: "Worth the booking effort — the kind of meal you'll remember" },
  },
  cafe_dweller: {
    key: "cafe_dweller",
    label: "The Café Dweller",
    tagline: "Latte before Slack.",
    insight: "Five out of seven mornings start the same way.",
    insights: [
      "You pick places that feel like extensions of your living room",
      "WiFi quality matters more than menu variety",
      "Your barista probably knows your order",
    ],
    recs: ["Blue Bottle", "Joe & The Juice", "the local coffee shop"],
    stretch: { name: "Devoción", reason: "Same vibe, more interesting — go on a workday" },
  },
  comfort_connoisseur: {
    key: "comfort_connoisseur",
    label: "The Comfort Food Connoisseur",
    tagline: "Pizza is a personality trait.",
    insight: "You eat what you actually want, not what looks good on Instagram.",
    insights: [
      "You have a 'rough day' restaurant — no menu needed",
      "Comfort beats novelty when you're tired",
      "You don't apologize for the pizza order",
    ],
    recs: ["Joe's Pizza", "Five Guys", "the diner"],
    stretch: { name: "Lucali", reason: "Same vibe, level up the slice — worth the wait" },
  },
  fast_casual_regular: {
    key: "fast_casual_regular",
    label: "The Fast Casual Regular",
    tagline: "Healthy-ish, fast, on the way.",
    insight: "You optimize for speed without giving up standards.",
    insights: [
      "You'd choose Sweetgreen over cooking, even on a free night",
      "Meals should feel efficient AND fresh",
      "Quick service is a feature, not a compromise",
    ],
    recs: ["Sweetgreen", "Cava", "Chipotle"],
    stretch: { name: "Dig Inn", reason: "Same lane, more flavor — try the new one" },
  },
  social_diner: {
    key: "social_diner",
    label: "The Social Diner",
    tagline: "Food is the excuse, the table is the point.",
    insight: "Your most memorable meals are about the company, not the cuisine.",
    insights: [
      "You'd take a mediocre meal with great people over a great meal alone",
      "You can't always remember what you ordered — but you remember who",
      "Long dinners > short ones, every time",
    ],
    recs: ["the wine bar", "the group dinner spot", "wherever the friends are"],
    stretch: { name: "Lilia", reason: "Bookable, beautiful, designed for a crew of four" },
  },
};

// ----------------------------------------------------------------------------
// Scoring
// ----------------------------------------------------------------------------

export function tallyPersona(answers: QuizOption[]): StarterPersonaKey {
  const totals: Partial<Record<StarterPersonaKey, number>> = {};
  for (const a of answers) {
    for (const [persona, weight] of Object.entries(a.personaWeights) as Array<[StarterPersonaKey, number]>) {
      totals[persona] = (totals[persona] ?? 0) + weight;
    }
  }
  const entries = Object.entries(totals) as Array<[StarterPersonaKey, number]>;
  if (entries.length === 0) return "convenience_loyalist";
  const max = Math.max(...entries.map(([, v]) => v));
  const winners = entries.filter(([, v]) => v === max).map(([k]) => k);
  if (winners.length > 1 && answers.length > 0) {
    const lastWeights = answers[answers.length - 1].personaWeights;
    const recencyMatch = winners.find((k) => (lastWeights[k] ?? 0) > 0);
    if (recencyMatch) return recencyMatch;
  }
  return winners[0];
}

export function chipsFromAnswers(answers: QuizOption[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of answers) {
    if (!seen.has(a.chip)) {
      seen.add(a.chip);
      out.push(a.chip);
    }
  }
  return out.slice(0, 4);
}
