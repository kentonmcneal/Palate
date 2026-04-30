// ============================================================================
// quiz-taxonomy.ts — questions, options, scoring, micro-feedback, chips.
// ----------------------------------------------------------------------------
// Single source of truth for the Starter Palate quiz. The PalateQuiz component
// is presentational; this file holds all copy and scoring logic so iterating
// on tone or scoring weights doesn't require touching React.
//
// SCORING (v2): each option contributes weighted points to MULTIPLE personas
// (was: one option = one vote for one persona). Five questions × four options
// each = 1024 unique answer paths mapping to 9 personas — far more variety
// than the v1 vote-counting system. Tie-break still favors the most recent
// answer.
// ============================================================================

import type { Signal } from "./signals";
import type { StarterPersonaKey } from "./starter-personas";

export type QuizLean = "routine" | "exploration" | "intentional" | "indulgent" | "social";

export type PersonaWeights = Partial<Record<StarterPersonaKey, number>>;

export type QuizOption = {
  emoji: string;
  /** What the option says. Behavioral confessions, not menu items. */
  text: string;
  /** Weighted votes this option casts toward each persona. Sum doesn't need to equal anything. */
  personaWeights: PersonaWeights;
  /** Coarser axis for the progressive-reveal hint between questions. */
  lean: QuizLean;
  /** Signals this answer contributes to the user's profile. */
  signals: Signal[];
  /** Short chip shown on the result card explaining why we picked this persona. */
  chip: string;
  /** Micro-feedback shown for ~1 second after the user picks this option. */
  feedback: string;
};

export type QuizQuestion = {
  id: string;
  prompt: string;
  options: QuizOption[];
};

// ----------------------------------------------------------------------------
// QUESTIONS — five total, designed to cross-cut the persona space rather
// than each question pointing at one persona. The first three set the broad
// pattern (routine vs exploration, comfort vs healthy). Q4 adds price/social
// signal. Q5 surfaces what they remember most about meals.
// ----------------------------------------------------------------------------

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: "tuesday_night",
    prompt: "It's a Tuesday at 7:30pm. You haven't eaten yet.",
    options: [
      {
        emoji: "🥡",
        text: "I'm not deciding. I'm getting the thing that always hits.",
        personaWeights: { convenience_loyalist: 3, flavor_loyalist: 1 },
        lean: "routine",
        signals: ["no_friction", "routine"],
        chip: "Low decision effort",
        feedback: "You lean routine over exploration.",
      },
      {
        emoji: "🌮",
        text: "Walking ten minutes for the place I've been meaning to try.",
        personaWeights: { explorer: 3, practical_variety_seeker: 1 },
        lean: "exploration",
        signals: ["novelty", "intentional"],
        chip: "Try-new energy",
        feedback: "You'd rather try than repeat.",
      },
      {
        emoji: "🥗",
        text: "Something healthy-ish, fast, and on the way.",
        personaWeights: { fast_casual_regular: 3, practical_variety_seeker: 1 },
        lean: "intentional",
        signals: ["healthy_ish", "convenience", "intentional"],
        chip: "Healthy-ish choices",
        feedback: "You like convenience, but you still want it to feel intentional.",
      },
      {
        emoji: "🍔",
        text: "I had a long day. I'm getting the thing I keep thinking about.",
        personaWeights: { comfort_connoisseur: 3, flavor_loyalist: 2 },
        lean: "indulgent",
        signals: ["indulgence", "flavor_driven"],
        chip: "Comfort over optics",
        feedback: "Tonight, comfort wins. No notes.",
      },
    ],
  },
  {
    id: "saturday_afternoon",
    prompt: "Saturday afternoon, hungry and uncommitted.",
    options: [
      {
        emoji: "☕",
        text: "Same café. Same order. No surprises.",
        personaWeights: { cafe_dweller: 3, convenience_loyalist: 1 },
        lean: "routine",
        signals: ["routine", "intentional"],
        chip: "Coffee shop loyalty",
        feedback: "Same place, same order. There's a rhythm to it.",
      },
      {
        emoji: "📸",
        text: "Somewhere I'd actually want to talk about. The vibe matters.",
        personaWeights: { explorer: 2, premium_comfort_loyalist: 2, social_diner: 1 },
        lean: "exploration",
        signals: ["novelty", "premium", "intentional"],
        chip: "Vibe over speed",
        feedback: "You're picking for the story, not just the food.",
      },
      {
        emoji: "⚡",
        text: "Whatever's open and fast. I'm not making decisions today.",
        personaWeights: { convenience_loyalist: 3, fast_casual_regular: 1 },
        lean: "routine",
        signals: ["no_friction", "convenience"],
        chip: "Convenience matters",
        feedback: "Speed is the priority. No shame in that.",
      },
      {
        emoji: "🥑",
        text: "Something fresh. I've been eating heavy all week.",
        personaWeights: { fast_casual_regular: 3, practical_variety_seeker: 1 },
        lean: "intentional",
        signals: ["healthy_ish", "intentional"],
        chip: "Bowls over brunch",
        feedback: "You're staying on track. Even on a Saturday.",
      },
    ],
  },
  {
    id: "best_meal",
    prompt: "A friend asks: \"best meal you had this month?\"",
    options: [
      {
        emoji: "🔥",
        text: "Honestly? That one indulgent thing I can't stop thinking about.",
        personaWeights: { comfort_connoisseur: 3, flavor_loyalist: 2 },
        lean: "indulgent",
        signals: ["indulgence", "flavor_driven"],
        chip: "Indulgent and proud",
        feedback: "Comfort food sticks. That's not a flaw, that's identity.",
      },
      {
        emoji: "🆕",
        text: "A new spot a friend dragged me to. I never would have gone.",
        personaWeights: { explorer: 3, social_diner: 2 },
        lean: "exploration",
        signals: ["novelty", "social"],
        chip: "New > known",
        feedback: "Some of your best meals happen because someone else picked.",
      },
      {
        emoji: "🥣",
        text: "The exact bowl I get every Thursday. Don't judge.",
        personaWeights: { convenience_loyalist: 2, fast_casual_regular: 2 },
        lean: "routine",
        signals: ["routine", "no_friction"],
        chip: "Repeat-order energy",
        feedback: "Loyalty is its own kind of love.",
      },
      {
        emoji: "🥐",
        text: "Long brunch with great coffee, somewhere quiet.",
        personaWeights: { cafe_dweller: 3, premium_comfort_loyalist: 1 },
        lean: "intentional",
        signals: ["intentional", "premium"],
        chip: "Slow Saturday energy",
        feedback: "The meal is the medium. The mood is the point.",
      },
    ],
  },
  {
    id: "the_bill",
    prompt: "When the bill comes, you…",
    options: [
      {
        emoji: "🙋",
        text: "I split it. Money stuff is a vibe-killer.",
        personaWeights: { social_diner: 3, comfort_connoisseur: 1 },
        lean: "social",
        signals: ["social"],
        chip: "Tab is the table's",
        feedback: "Food is the excuse, the table is the point.",
      },
      {
        emoji: "💸",
        text: "I check the math. Always.",
        personaWeights: { convenience_loyalist: 2, practical_variety_seeker: 1 },
        lean: "routine",
        signals: ["value", "intentional"],
        chip: "Value-aware",
        feedback: "You know exactly where the money goes.",
      },
      {
        emoji: "✨",
        text: "I don't really notice. Good food is worth it.",
        personaWeights: { premium_comfort_loyalist: 3, flavor_loyalist: 2 },
        lean: "indulgent",
        signals: ["premium", "flavor_driven"],
        chip: "Quality over price",
        feedback: "You'll pay for the thing you actually want.",
      },
      {
        emoji: "🍳",
        text: "I'd rather have spent that on groceries.",
        personaWeights: { fast_casual_regular: 2, cafe_dweller: 1, practical_variety_seeker: 1 },
        lean: "intentional",
        signals: ["healthy_ish", "value", "intentional"],
        chip: "Cook-at-home leanings",
        feedback: "You like eating out — but the math is in your head.",
      },
    ],
  },
  {
    id: "memorable_meal",
    prompt: "Your last memorable meal was about…",
    options: [
      {
        emoji: "🌶️",
        text: "The food itself. A specific flavor I can't stop thinking about.",
        personaWeights: { flavor_loyalist: 3, comfort_connoisseur: 1 },
        lean: "indulgent",
        signals: ["flavor_driven"],
        chip: "Flavor-first",
        feedback: "You don't forget a great bite.",
      },
      {
        emoji: "👯",
        text: "The people I was with. Honestly can't remember what I ordered.",
        personaWeights: { social_diner: 3, explorer: 1 },
        lean: "social",
        signals: ["social"],
        chip: "People > plate",
        feedback: "Food is the canvas. The company is the painting.",
      },
      {
        emoji: "💯",
        text: "Trying something I'd never had before. New cuisine, new dish.",
        personaWeights: { explorer: 3, premium_comfort_loyalist: 1 },
        lean: "exploration",
        signals: ["novelty", "intentional"],
        chip: "First-time energy",
        feedback: "Novelty is the meal you remember.",
      },
      {
        emoji: "🛋️",
        text: "Just relaxing. Comfort food, no pressure, my favorite spot.",
        personaWeights: { comfort_connoisseur: 2, cafe_dweller: 2, convenience_loyalist: 1 },
        lean: "routine",
        signals: ["comfort_food", "routine"],
        chip: "Comfort = memory",
        feedback: "Familiar is its own kind of special.",
      },
    ],
  },
];

// ============================================================================
// Scoring helpers — pure functions so the component stays presentational.
// ============================================================================

/** Sums weighted persona votes across all picked options; ties broken by recency. */
export function tallyPersona(answers: QuizOption[]): StarterPersonaKey {
  const totals: Partial<Record<StarterPersonaKey, number>> = {};
  for (const a of answers) {
    for (const [persona, weight] of Object.entries(a.personaWeights) as Array<[StarterPersonaKey, number]>) {
      totals[persona] = (totals[persona] ?? 0) + weight;
    }
  }
  const entries = Object.entries(totals) as Array<[StarterPersonaKey, number]>;
  if (entries.length === 0) return "convenience_loyalist"; // safe fallback, should never hit
  const max = Math.max(...entries.map(([, v]) => v));
  const winners = entries.filter(([, v]) => v === max).map(([k]) => k);
  if (winners.length > 1 && answers.length > 0) {
    // Tie-break: pick the persona the most recent answer voted for, if it tied.
    const lastWeights = answers[answers.length - 1].personaWeights;
    const recencyMatch = winners.find((k) => (lastWeights[k] ?? 0) > 0);
    if (recencyMatch) return recencyMatch;
  }
  return winners[0];
}

/** "Why we think this" chips. Dedupes, caps at 4, preserves answer order. */
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

/** Composite identity hint shown between questions — sharper as data accumulates. */
export function progressiveReveal(answers: QuizOption[]): string {
  if (answers.length === 0) return "";
  if (answers.length === 1) {
    switch (answers[0].lean) {
      case "routine":     return "You're starting to look like a routine eater…";
      case "exploration": return "An explorer in the making…";
      case "intentional": return "Someone who picks on purpose…";
      case "indulgent":   return "Comfort food has your number tonight…";
      case "social":      return "The table is the point, not the menu…";
    }
  }
  const leans = answers.map((a) => a.lean);
  const unique = new Set(leans).size;
  if (unique === 1) {
    switch (leans[0]) {
      case "routine":     return "Two for two on routine. You like what you like.";
      case "exploration": return "Two for two on exploration. You don't repeat.";
      case "intentional": return "Two for two on intentional choices. You don't drift.";
      case "social":      return "Food is showing up as a social act. Noted.";
      default:            return "You're consistent. That's a tell.";
    }
  }
  if (answers.length === 2) {
    return "Routine, with the occasional dare. You're balancing two modes.";
  }
  if (answers.length === 3) {
    return "Three answers in. The picture is sharpening.";
  }
  return "One more. The picture is almost done.";
}
