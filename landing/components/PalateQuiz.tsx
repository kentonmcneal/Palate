"use client";

import { useEffect, useState } from "react";
import {
  QUIZ_QUESTIONS,
  tallyPersona,
  chipsFromAnswers,
  progressiveReveal,
  type QuizOption,
} from "@/config/quiz-taxonomy";
import { STARTER_PERSONAS, type StarterPersonaKey } from "@/config/starter-personas";
import { QuizEvents } from "@/lib/quiz-events";

// ============================================================================
// PalateQuiz — Starter Palate reveal (NOT a survey).
// ----------------------------------------------------------------------------
// All copy + scoring lives in landing/config/. This component is the shell:
// renders questions, the micro-feedback overlay, the progressive reveal hint,
// and the result card. Fires the 7 quiz analytics events from lib/quiz-events.
// ============================================================================

export function PalateQuiz() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<QuizOption[]>([]);
  const [microfeedback, setMicrofeedback] = useState<string | null>(null);
  const [hasFiredCompletion, setHasFiredCompletion] = useState(false);

  // Fire quiz_started exactly once on first mount.
  useEffect(() => { QuizEvents.started(); }, []);

  // Fire completion + starter generation on first transition into the result.
  useEffect(() => {
    if (step >= QUIZ_QUESTIONS.length && !hasFiredCompletion) {
      const persona = tallyPersona(answers);
      const chips = chipsFromAnswers(answers);
      QuizEvents.completed({ persona, answeredCount: answers.length });
      QuizEvents.starterPalateGenerated({ persona, chips });
      setHasFiredCompletion(true);
    }
  }, [step, answers, hasFiredCompletion]);

  function pick(opt: QuizOption) {
    const next = [...answers, opt];
    const idx = answers.length;
    setAnswers(next);
    setMicrofeedback(opt.feedback);
    QuizEvents.questionAnswered({
      questionId: QUIZ_QUESTIONS[idx].id,
      questionIndex: idx,
      persona: opt.persona,
      chip: opt.chip,
    });
    setTimeout(() => {
      setMicrofeedback(null);
      setStep((s) => s + 1);
    }, 1100);
  }

  function reset() {
    setAnswers([]);
    setStep(0);
    setMicrofeedback(null);
    setHasFiredCompletion(false);
    QuizEvents.started();
  }

  // -------------------- RESULT --------------------
  if (step >= QUIZ_QUESTIONS.length) {
    const personaKey = tallyPersona(answers);
    const chips = chipsFromAnswers(answers);
    return <ResultCard personaKey={personaKey} chips={chips} onReset={reset} />;
  }

  // -------------------- QUESTION --------------------
  const q = QUIZ_QUESTIONS[step];
  const reveal = progressiveReveal(answers);

  return (
    <div className="rounded-3xl border border-palate-line bg-white p-8 sm:p-10 shadow-card relative overflow-hidden">
      <div className="flex items-center justify-between text-xs font-semibold text-palate-mute tracking-widest uppercase">
        <span>Question {step + 1} of {QUIZ_QUESTIONS.length}</span>
        <span className="flex gap-1.5">
          {QUIZ_QUESTIONS.map((_, i) => (
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

// ============================================================================
// Result card — Starter Palate reveal with chips, framing, share, and CTAs.
// ============================================================================

function ResultCard({
  personaKey,
  chips,
  onReset,
}: {
  personaKey: StarterPersonaKey;
  chips: string[];
  onReset: () => void;
}) {
  const persona = STARTER_PERSONAS[personaKey];
  const [shareLabel, setShareLabel] = useState("Share my Palate");

  const cardUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/palate-card/${personaKey}`
      : `/api/palate-card/${personaKey}`;

  async function handleShare() {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://palate.app";
    // Share a link to the per-persona landing page so previews render the OG card.
    const shareUrl = `${origin}/share/${personaKey}`;
    const shareText = `I'm ${persona.label}: "${persona.tagline}". Find your Palate at`;
    QuizEvents.shareCardClicked({ persona: personaKey, method: "native" });
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `My Palate: ${persona.label}`,
          text: shareText,
          url: shareUrl,
        });
        return;
      } catch {
        // User cancelled or share unavailable — fall through to copy.
      }
    }
    try {
      await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
      QuizEvents.shareCardClicked({ persona: personaKey, method: "copy" });
      setShareLabel("Copied to clipboard");
      setTimeout(() => setShareLabel("Share my Palate"), 2200);
    } catch {
      setShareLabel("Couldn't share");
      setTimeout(() => setShareLabel("Share my Palate"), 2200);
    }
  }

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
          {persona.label}
        </div>

        <div className="mt-3 text-base sm:text-lg font-medium opacity-90 italic">
          "{persona.tagline}"
        </div>

        <p className="mt-6 text-white/80 max-w-md mx-auto leading-relaxed">
          {persona.insight}
        </p>

        {/* Why we think this */}
        {chips.length > 0 && (
          <div className="mt-7 flex flex-wrap justify-center gap-2 max-w-md mx-auto">
            <div className="w-full text-[10px] font-semibold tracking-widest uppercase text-white/55 mb-1">
              Why we think this
            </div>
            {chips.map((c) => (
              <span
                key={c}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white"
              >
                {c}
              </span>
            ))}
          </div>
        )}

        {/* "You probably…" callout */}
        <div className="mt-8 mx-auto max-w-md rounded-2xl border border-white/15 bg-white/5 px-5 py-4">
          <div className="text-[10px] tracking-widest uppercase text-palate-red font-semibold">
            You probably…
          </div>
          <p className="mt-2 text-white text-[15px] leading-relaxed">
            {persona.probably}
          </p>
        </div>

        {/* Starter vs Weekly framing — three punchy lines */}
        <div className="mt-6 max-w-md mx-auto space-y-1">
          <p className="text-sm text-white/85 font-semibold">
            This is your Starter Palate.
          </p>
          <p className="text-sm text-white/65">
            Your real Palate is built from where you actually go.
          </p>
          <p className="text-sm text-white/65">
            After one week of visits, you'll unlock your first Weekly Wrapped.
          </p>
        </div>

        {/* CTAs */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            href="#waitlist"
            onClick={() => QuizEvents.saveMyPalateClicked({ persona: personaKey })}
            className="inline-flex rounded-full bg-palate-red text-white px-6 py-3 text-sm font-semibold hover:opacity-90"
          >
            Save my Palate · Join the waitlist
          </a>
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex rounded-full border border-white/30 text-white/85 px-5 py-3 text-sm font-semibold hover:bg-white/10"
          >
            {shareLabel}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex text-white/55 px-3 py-2 text-sm hover:text-white/85"
          >
            Try again
          </button>
        </div>

        <div className="mt-3 text-[10px] text-white/35">
          <a href={cardUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-white/60">
            View shareable card
          </a>
        </div>
      </div>
    </div>
  );
}
