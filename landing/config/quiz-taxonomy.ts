// ============================================================================
// quiz-taxonomy.ts — questions, options, scoring, micro-feedback, chips.
// ----------------------------------------------------------------------------
// Single source of truth for the Starter Palate quiz. The PalateQuiz component
// is presentational; this file holds all copy and scoring logic so iterating
// on tone or scoring weights doesn't require touching React.
//
// Scoring: each option contributes one point to its `persona` key. Tie-break
// goes to the most recent (Q3) answer. Each option also carries a `chip`
// string — the user sees these on the result card as "Why we think this".
// ============================================================================

import type { Signal } from "./signals";
import type { StarterPersonaKey } from "./starter-personas";

export type QuizLean = "routine" | "exploration" | "intentional" | "indulgent" | "social";

export type QuizOption = {
  emoji: string;
  /** What the option says. Behavioral confessions, not menu items. */
  text: string;
  /** Persona this option votes for. */
  persona: StarterPersonaKey;
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

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: "tuesday_night",
    prompt: "It's a Tuesday at 7:30pm. You haven't eaten yet.",
    options: [
      {
        emoji: "🥡",
        text: "I'm not deciding. I'm getting the thing that always hits.",
        persona: "convenience_loyalist",
        lean: "routine",
        signals: ["no_friction", "routine"],
        chip: "Low decision effort",
        feedback: "You lean routine over exploration.",
      },
      {
        emoji: "🌮",
        text: "Walking ten minutes for the place I've been meaning to try.",
        persona: "explorer",
        lean: "exploration",
        signals: ["novelty", "intentional"],
        chip: "Try-new energy",
        feedback: "You'd rather try than repeat.",
      },
      {
        emoji: "🥗",
        text: "Something healthy-ish, fast, and on the way.",
        persona: "fast_casual_regular",
        lean: "intentional",
        signals: ["healthy_ish", "convenience", "intentional"],
        chip: "Healthy-ish choices",
        feedback: "You like convenience, but you still want it to feel intentional.",
      },
      {
        emoji: "🍔",
        text: "I had a long day. I'm getting the thing I keep thinking about.",
        persona: "comfort_connoisseur",
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
        persona: "cafe_dweller",
        lean: "routine",
        signals: ["routine", "intentional"],
        chip: "Coffee shop loyalty",
        feedback: "Same place, same order. There's a rhythm to it.",
      },
      {
        emoji: "📸",
        text: "Somewhere I'd actually want to talk about. The vibe matters.",
        persona: "explorer",
        lean: "exploration",
        signals: ["novelty", "premium", "intentional"],
        chip: "Vibe over speed",
        feedback: "You're picking for the story, not the food.",
      },
      {
        emoji: "⚡",
        text: "Whatever's open and fast. I'm not making decisions today.",
        persona: "convenience_loyalist",
        lean: "routine",
        signals: ["no_friction", "convenience"],
        chip: "Convenience matters",
        feedback: "Speed is the priority. No shame in that.",
      },
      {
        emoji: "🥑",
        text: "Something fresh. I've been eating heavy all week.",
        persona: "fast_casual_regular",
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
        persona: "comfort_connoisseur",
        lean: "indulgent",
        signals: ["indulgence", "flavor_driven"],
        chip: "Indulgent and proud",
        feedback: "Comfort food sticks. That's not a flaw, that's identity.",
      },
      {
        emoji: "🆕",
        text: "A new spot a friend dragged me to. I never would have gone.",
        persona: "explorer",
        lean: "exploration",
        signals: ["novelty", "social"],
        chip: "New > known",
        feedback: "Some of your best meals happen because someone else picked.",
      },
      {
        emoji: "🥣",
        text: "The exact bowl I get every Thursday. Don't judge.",
        persona: "convenience_loyalist",
        lean: "routine",
        signals: ["routine", "no_friction"],
        chip: "Repeat-order energy",
        feedback: "Loyalty is its own kind of love.",
      },
      {
        emoji: "🥐",
        text: "Long brunch with great coffee, somewhere quiet.",
        persona: "cafe_dweller",
        lean: "intentional",
        signals: ["intentional", "premium"],
        chip: "Slow Saturday energy",
        feedback: "The meal is the medium. The mood is the point.",
      },
    ],
  },
];

// ============================================================================
// Scoring helpers — pure functions so the component stays presentational.
// ============================================================================

export function tallyPersona(answers: QuizOption[]): StarterPersonaKey {
  const counts: Record<string, number> = {};
  for (const a of answers) counts[a.persona] = (counts[a.persona] ?? 0) + 1;
  const max = Math.max(...Object.values(counts));
  const winners = Object.keys(counts).filter((k) => counts[k] === max);
  if (winners.length > 1 && answers.length > 0) {
    const last = answers[answers.length - 1].persona;
    if (winners.includes(last)) return last;
  }
  return winners[0] as StarterPersonaKey;
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
      default:            return "You're consistent. That's a tell.";
    }
  }
  return "Routine, with the occasional dare. You're balancing two modes.";
}
