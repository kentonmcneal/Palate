"use client";

import { useState } from "react";

type Personality = "Loyalist" | "Explorer" | "Café Dweller" | "Fast Casual" | "Comfort";

type Option = { emoji: string; label: string; key: Personality };

type Question = {
  prompt: string;
  options: Option[];
};

const QUESTIONS: Question[] = [
  {
    prompt: "Your usual Sunday morning…",
    options: [
      { emoji: "☕", label: "Same café, same latte",         key: "Café Dweller" },
      { emoji: "🥐", label: "A bakery you've never tried",   key: "Explorer" },
      { emoji: "🥞", label: "Brunch at the regular spot",    key: "Loyalist" },
      { emoji: "🥗", label: "Quick juice, then go run",      key: "Fast Casual" },
    ],
  },
  {
    prompt: "Tuesday night dinner is…",
    options: [
      { emoji: "🍕", label: "Pizza from the usual",          key: "Loyalist" },
      { emoji: "🌮", label: "New taco place a friend mentioned", key: "Explorer" },
      { emoji: "🥗", label: "Sweetgreen on the way home",    key: "Fast Casual" },
      { emoji: "🍔", label: "Comfort food, no thinking",     key: "Comfort" },
    ],
  },
  {
    prompt: "If money weren't a thing, your dream meal is…",
    options: [
      { emoji: "🍣", label: "Tasting menu, somewhere new",   key: "Explorer" },
      { emoji: "🍔", label: "The perfect smashburger",       key: "Comfort" },
      { emoji: "☕", label: "Long brunch with great coffee", key: "Café Dweller" },
      { emoji: "🥑", label: "A bowl that actually hits",     key: "Fast Casual" },
    ],
  },
];

const PERSONALITY_DETAILS: Record<Personality, {
  title: string;
  tagline: string;
  blurb: string;
}> = {
  Loyalist: {
    title: "The Loyalist",
    tagline: "If a place is good, why fix it?",
    blurb: "You eat at the same 3 spots like clockwork — and there's nothing wrong with that.",
  },
  Explorer: {
    title: "The Explorer",
    tagline: "Three new spots a week, minimum.",
    blurb: "You haven't been to the same restaurant twice this month. Your camera roll knows.",
  },
  "Café Dweller": {
    title: "The Café Dweller",
    tagline: "Latte before Slack.",
    blurb: "Five out of seven mornings start the same way. The barista already knows your order.",
  },
  "Fast Casual": {
    title: "The Fast Casual Regular",
    tagline: "Healthy-ish, fast, on the way.",
    blurb: "Your week runs on bowls and counter service. You've earned a Sweetgreen black card.",
  },
  Comfort: {
    title: "The Comfort Food Connoisseur",
    tagline: "Pizza is a personality trait.",
    blurb: "You eat what you actually want, and we love that for you. The fancy place can wait.",
  },
};

function tally(answers: Personality[]): Personality {
  const counts: Record<string, number> = {};
  for (const a of answers) counts[a] = (counts[a] ?? 0) + 1;
  const max = Math.max(...Object.values(counts));
  // Tie-break: trust the most recent (Q3) answer.
  const winners = Object.keys(counts).filter((k) => counts[k] === max);
  if (winners.length > 1 && answers.length > 0) {
    const last = answers[answers.length - 1];
    if (winners.includes(last)) return last;
  }
  return winners[0] as Personality;
}

export function PalateQuiz() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Personality[]>([]);

  function pick(opt: Option) {
    const next = [...answers, opt.key];
    setAnswers(next);
    setStep((s) => s + 1);
  }

  function reset() {
    setAnswers([]);
    setStep(0);
  }

  if (step >= QUESTIONS.length) {
    const personality = tally(answers);
    const detail = PERSONALITY_DETAILS[personality];

    return (
      <div className="rounded-3xl overflow-hidden text-white relative shadow-card"
           style={{ background: "linear-gradient(135deg,#1A1A1A,#0E0E0E)" }}>
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
          <p className="mt-6 text-white/75 max-w-md mx-auto leading-relaxed">
            {detail.blurb}
          </p>
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

  const q = QUESTIONS[step];
  return (
    <div className="rounded-3xl border border-palate-line bg-white p-8 sm:p-10 shadow-card">
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
      <h3 className="mt-5 text-2xl sm:text-3xl font-semibold tracking-tightest leading-snug">
        {q.prompt}
      </h3>
      <div className="mt-8 grid sm:grid-cols-2 gap-3">
        {q.options.map((o) => (
          <button
            key={o.label}
            onClick={() => pick(o)}
            className="group flex items-center gap-4 rounded-2xl border border-palate-line bg-white px-5 py-4 text-left hover:border-palate-red hover:bg-palate-soft transition"
          >
            <span className="text-2xl group-hover:scale-110 transition-transform">{o.emoji}</span>
            <span className="font-medium text-[15px] text-palate-ink">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
