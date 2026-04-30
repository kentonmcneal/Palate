"use client";

import { useState } from "react";

// ============================================================================
// PalateQuiz — onboarding personality reveal (NOT a survey)
// ----------------------------------------------------------------------------
// Rules from the product spec:
//   1. Answers must sound like real human behavior, not menu options.
//   2. Choices force tradeoffs (routine vs exploration, convenience vs intentional).
//   3. After each pick, show micro-feedback ("You lean toward routine over exploration.")
//   4. Show progressive identity reveal between questions.
//   5. Final result: persona + "You probably…" callout.
// ============================================================================

type Persona =
  | "convenience_loyalist"
  | "explorer"
  | "cafe_dweller"
  | "comfort_connoisseur"
  | "healthy_optimizer";

type Lean = "routine" | "exploration" | "intentional" | "indulgent" | "social";

type Option = {
  emoji: string;
  text: string;
  persona: Persona;
  lean: Lean;
  /** Micro-feedback shown after this answer is picked. */
  feedback: string;
};

type Question = {
  prompt: string;
  options: Option[];
};

const QUESTIONS: Question[] = [
  {
    prompt: "It's a Tuesday at 7:30pm. You haven't eaten yet.",
    options: [
      {
        emoji: "🥡",
        text: "Honestly? I'm getting the same thing I had last Tuesday.",
        persona: "convenience_loyalist",
        lean: "routine",
        feedback: "You lean toward routine over exploration.",
      },
      {
        emoji: "🌮",
        text: "Walking ten minutes for the place I've been meaning to try.",
        persona: "explorer",
        lean: "exploration",
        feedback: "You'd rather try than repeat.",
      },
      {
        emoji: "🥗",
        text: "The salad place. I'm trying to be intentional this week.",
        persona: "healthy_optimizer",
        lean: "intentional",
        feedback: "You're choosing on purpose.",
      },
      {
        emoji: "🍔",
        text: "I had a long day. I'm getting the burger I keep thinking about.",
        persona: "comfort_connoisseur",
        lean: "indulgent",
        feedback: "Tonight, comfort wins.",
      },
    ],
  },
  {
    prompt: "Saturday afternoon, you're hungry and uncommitted.",
    options: [
      {
        emoji: "☕",
        text: "I drift toward the same coffee shop. Always.",
        persona: "cafe_dweller",
        lean: "routine",
        feedback: "Same place, same order. There's a rhythm to it.",
      },
      {
        emoji: "📸",
        text: "I want somewhere I'd actually want to talk about. The vibe matters.",
        persona: "explorer",
        lean: "exploration",
        feedback: "You're picking for the story, not the food.",
      },
      {
        emoji: "⚡",
        text: "Whatever's open and fast. I'm not making decisions today.",
        persona: "convenience_loyalist",
        lean: "routine",
        feedback: "Speed is the priority. No shame in that.",
      },
      {
        emoji: "🥑",
        text: "Something fresh. I've been eating heavy all week.",
        persona: "healthy_optimizer",
        lean: "intentional",
        feedback: "You're staying on track. Even on a Saturday.",
      },
    ],
  },
  {
    prompt: "A friend asks: \"best meal you had this month?\"",
    options: [
      {
        emoji: "🔥",
        text: "Honestly? That one indulgent burger I keep thinking about.",
        persona: "comfort_connoisseur",
        lean: "indulgent",
        feedback: "Comfort food sticks. That's not a flaw, that's identity.",
      },
      {
        emoji: "🆕",
        text: "A new spot a friend dragged me to. I never would have gone.",
        persona: "explorer",
        lean: "exploration",
        feedback: "Some of your best meals happen because someone else picked.",
      },
      {
        emoji: "🥣",
        text: "The exact bowl I get every Thursday. Don't judge.",
        persona: "convenience_loyalist",
        lean: "routine",
        feedback: "Loyalty is its own kind of love.",
      },
      {
        emoji: "🥐",
        text: "Long brunch with great coffee, somewhere quiet.",
        persona: "cafe_dweller",
        lean: "intentional",
        feedback: "The meal is the medium. The mood is the point.",
      },
    ],
  },
];

// ============================================================================
// Persona definitions — match the mobile palate-persona.ts identities
// ============================================================================

const PERSONA_DETAILS: Record<Persona, {
  title: string;
  tagline: string;
  description: string;
  probably: string;
}> = {
  convenience_loyalist: {
    title: "The Convenience Loyalist",
    tagline: "Speed and familiarity, no thinking required.",
    description:
      "You optimize for friction. The same order, the same hour, the same trusted spot — that's not a rut, that's a system. You've done the picking, now you're enjoying the not-picking.",
    probably: "You probably have the same lunch order Mon-Wed-Fri, and you're not changing it.",
  },
  explorer: {
    title: "The Explorer",
    tagline: "Three new spots a week, minimum.",
    description:
      "You'd rather try and miss than repeat and feel safe. You're collecting places, not patterns. Your camera roll is half restaurant signs.",
    probably: "You probably have a saved list of 30 places you still haven't gotten to.",
  },
  cafe_dweller: {
    title: "The Café Dweller",
    tagline: "Latte before Slack.",
    description:
      "Five out of seven mornings start the same way. You pick places that feel like extensions of your living room, where the WiFi works and the barista already knows your order.",
    probably: "You probably know your barista's name. They probably know yours.",
  },
  comfort_connoisseur: {
    title: "The Comfort Food Connoisseur",
    tagline: "Pizza is a personality trait.",
    description:
      "You eat what you actually want, not what looks good on Instagram. The fancy place can wait — tonight is about the slice, the burger, the bowl that just hits.",
    probably: "You probably have a 'rough day' restaurant. You don't even need a menu.",
  },
  healthy_optimizer: {
    title: "The Fast Casual Regular",
    tagline: "Healthy-ish, fast, on the way.",
    description:
      "You optimize for speed without giving up the plot. Your week runs on bowls and counter service. You'd choose the salad place over cooking, even when you have time.",
    probably: "You'd probably choose Sweetgreen over cooking, even when you have time.",
  },
};

function tally(answers: Option[]): Persona {
  const counts: Record<string, number> = {};
  for (const a of answers) counts[a.persona] = (counts[a.persona] ?? 0) + 1;
  const max = Math.max(...Object.values(counts));
  // Tie-break by Q3 (most recent / most considered answer)
  const winners = Object.keys(counts).filter((k) => counts[k] === max);
  if (winners.length > 1 && answers.length > 0) {
    const last = answers[answers.length - 1].persona;
    if (winners.includes(last)) return last;
  }
  return winners[0] as Persona;
}

/** Composite identity hint shown between questions — gets sharper as more data comes in. */
function progressiveReveal(answers: Option[]): string {
  if (answers.length === 0) return "";
  if (answers.length === 1) {
    const lean = answers[0].lean;
    if (lean === "routine") return "You're starting to look like a routine eater…";
    if (lean === "exploration") return "An explorer in the making…";
    if (lean === "intentional") return "Someone who picks on purpose…";
    if (lean === "indulgent") return "Comfort food has your number tonight…";
    return "Something interesting is forming…";
  }
  // After Q2 — composite read
  const leans = answers.map((a) => a.lean);
  const uniqueLeans = new Set(leans).size;
  if (uniqueLeans === 1) {
    if (leans[0] === "routine") return "Two for two on routine. You like what you like.";
    if (leans[0] === "exploration") return "Two for two on exploration. You don't repeat.";
    if (leans[0] === "intentional") return "Two for two on intentional choices. You don't drift.";
    return "You're consistent. That's a tell.";
  }
  return "Routine, with the occasional dare. You're balancing two modes.";
}

export function PalateQuiz() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Option[]>([]);
  const [microfeedback, setMicrofeedback] = useState<string | null>(null);

  function pick(opt: Option) {
    const next = [...answers, opt];
    setAnswers(next);
    setMicrofeedback(opt.feedback);
    // Hold the micro-feedback briefly, then advance
    setTimeout(() => {
      setMicrofeedback(null);
      setStep((s) => s + 1);
    }, 1100);
  }

  function reset() {
    setAnswers([]);
    setStep(0);
    setMicrofeedback(null);
  }

  // ---------------- RESULT ----------------
  if (step >= QUESTIONS.length) {
    const persona = tally(answers);
    const detail = PERSONA_DETAILS[persona];

    return (
      <div
        className="rounded-3xl overflow-hidden text-white relative shadow-card"
        style={{ background: "linear-gradient(135deg,#1A1A1A,#0E0E0E)" }}
      >
        <div className="glow-r" />
        <div className="relative p-10 sm:p-14 text-center">
          <div className="text-[11px] tracking-widest uppercase opacity-70">
            Your starter Palate
          </div>
          <div className="mt-3 text-3xl sm:text-5xl font-extrabold tracking-tightest text-palate-red leading-tight">
            {detail.title}
          </div>
          <div className="mt-3 text-base sm:text-lg font-medium opacity-90 italic">
            "{detail.tagline}"
          </div>
          <p className="mt-6 text-white/80 max-w-md mx-auto leading-relaxed">
            {detail.description}
          </p>
          <div className="mt-8 mx-auto max-w-md rounded-2xl border border-white/15 bg-white/5 px-5 py-4">
            <div className="text-[10px] tracking-widest uppercase text-palate-red font-semibold">
              You probably…
            </div>
            <p className="mt-2 text-white text-[15px] leading-relaxed">
              {detail.probably}
            </p>
          </div>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="#waitlist"
              className="inline-flex rounded-full bg-palate-red text-white px-6 py-3 text-sm font-semibold hover:opacity-90"
            >
              Save my Palate · Join the waitlist
            </a>
            <button
              onClick={reset}
              className="inline-flex rounded-full border border-white/30 text-white/80 px-5 py-3 text-sm font-semibold hover:bg-white/10"
            >
              Try again
            </button>
          </div>
          <p className="mt-6 text-xs text-white/50">
            This is a 30-second guess. The real one comes after a week of actual visits.
          </p>
        </div>
      </div>
    );
  }

  // ---------------- QUESTION ----------------
  const q = QUESTIONS[step];
  const reveal = progressiveReveal(answers);

  return (
    <div className="rounded-3xl border border-palate-line bg-white p-8 sm:p-10 shadow-card relative overflow-hidden">
      {/* progress + reveal header */}
      <div className="flex items-center justify-between text-xs font-semibold text-palate-mute tracking-widest uppercase">
        <span>Question {step + 1} of {QUESTIONS.length}</span>
        <span className="flex gap-1.5">
          {QUESTIONS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-6 rounded-full ${i <= step ? "bg-palate-red" : "bg-palate-line"}`}
            />
          ))}
        </span>
      </div>

      {reveal && step > 0 && (
        <div className="mt-4 text-sm text-palate-red font-medium italic">
          {reveal}
        </div>
      )}

      <h3 className="mt-5 text-2xl sm:text-3xl font-semibold tracking-tightest leading-snug">
        {q.prompt}
      </h3>

      <div className="mt-8 grid sm:grid-cols-2 gap-3">
        {q.options.map((o) => (
          <button
            key={o.text}
            onClick={() => pick(o)}
            disabled={!!microfeedback}
            className="group flex items-start gap-4 rounded-2xl border border-palate-line bg-white px-5 py-4 text-left hover:border-palate-red hover:bg-palate-soft transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="text-2xl group-hover:scale-110 transition-transform pt-0.5">
              {o.emoji}
            </span>
            <span className="font-medium text-[15px] text-palate-ink leading-snug">
              {o.text}
            </span>
          </button>
        ))}
      </div>

      {/* micro-feedback overlay */}
      {microfeedback && (
        <div className="absolute inset-0 bg-white/95 backdrop-blur flex items-center justify-center px-8 animate-fade-in">
          <div className="text-center max-w-md">
            <div className="text-xs font-semibold text-palate-red tracking-widest uppercase">
              We see that
            </div>
            <p className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tightish leading-snug text-palate-ink">
              {microfeedback}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
