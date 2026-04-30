"use client";

import { useState } from "react";

// ============================================================================
// EvolutionScrubber — interactive 4-week scrubber showing the SAME fictional
// user landing on 4 different personas in 4 consecutive weeks. Drives the
// idea that "your Palate is a moving picture, not a one-time read."
// ============================================================================

type Week = {
  range: string;
  context: string;        // one-line setup ("You had a tough week", "Vacation hangover", etc.)
  persona: string;
  tagline: string;
  stats: { v: string; l: string }[];
  topSpots: { name: string; count: string }[];
  insight: string;        // 1-2 sentence read of the week
};

const WEEKS: Week[] = [
  {
    range: "Week 1 · Jan 6 – Jan 12",
    context: "Crunch week at work, no time to think.",
    persona: "The Convenience Loyalist",
    tagline: "Speed and familiarity, no thinking required.",
    stats: [
      { v: "9",   l: "visits" },
      { v: "2",   l: "places" },
      { v: "89%", l: "repeat" },
    ],
    topSpots: [
      { name: "McDonald's",   count: "×6" },
      { name: "Starbucks",    count: "×3" },
    ],
    insight: "You leaned hard on the spots that don't make you decide. Not a rut — a coping mechanism.",
  },
  {
    range: "Week 2 · Jan 13 – Jan 19",
    context: "Things calmed down. You wanted a real meal.",
    persona: "The Comfort Food Connoisseur",
    tagline: "Pizza is a personality trait.",
    stats: [
      { v: "7",   l: "visits" },
      { v: "4",   l: "places" },
      { v: "43%", l: "repeat" },
    ],
    topSpots: [
      { name: "Joe's Pizza",  count: "×3" },
      { name: "Five Guys",    count: "×2" },
      { name: "Sweetgreen",   count: "×1" },
    ],
    insight: "When you had room to choose, you chose what you actually wanted. That's a tell.",
  },
  {
    range: "Week 3 · Jan 20 – Jan 26",
    context: "A friend was visiting. You played tour guide.",
    persona: "The Explorer",
    tagline: "Three new spots a week, minimum.",
    stats: [
      { v: "11", l: "visits" },
      { v: "9",  l: "places" },
      { v: "18%", l: "repeat" },
    ],
    topSpots: [
      { name: "Bonnie's",     count: "new" },
      { name: "Le Crocodile", count: "new" },
      { name: "Shukette",     count: "new" },
    ],
    insight: "Nine different restaurants in one week. The right company turns you into someone else.",
  },
  {
    range: "Week 4 · Jan 27 – Feb 2",
    context: "Back to your real life. Back to the bowl.",
    persona: "The Fast Casual Regular",
    tagline: "Healthy-ish, fast, on the way.",
    stats: [
      { v: "10", l: "visits" },
      { v: "5",  l: "places" },
      { v: "50%", l: "repeat" },
    ],
    topSpots: [
      { name: "Sweetgreen",       count: "×4" },
      { name: "Cava",             count: "×2" },
      { name: "Joe & The Juice",  count: "×2" },
    ],
    insight: "Reset week. Bowls and counter service. This is your default — until next time it isn't.",
  },
];

export function EvolutionScrubber() {
  const [i, setI] = useState(0);
  const w = WEEKS[i];

  return (
    <div>
      {/* Week chips / progress */}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {WEEKS.map((wk, idx) => (
          <button
            key={wk.range}
            onClick={() => setI(idx)}
            aria-label={`Show ${wk.range}`}
            aria-current={i === idx}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition border ${
              i === idx
                ? "bg-palate-red text-white border-palate-red"
                : "bg-white text-palate-mute border-palate-line hover:border-palate-red hover:text-palate-ink"
            }`}
          >
            Week {idx + 1}
          </button>
        ))}
      </div>

      {/* Card */}
      <div className="mt-8 grid lg:grid-cols-[1.1fr_1fr] gap-6 lg:gap-10 items-stretch">
        {/* Left: dark persona reveal */}
        <div
          className="relative rounded-3xl overflow-hidden text-white shadow-card"
          style={{ background: "linear-gradient(135deg,#1A1A1A,#0E0E0E)" }}
        >
          <div className="glow-r" />
          <div className="relative p-8 sm:p-10">
            <div className="text-[11px] tracking-widest uppercase text-white/65">
              {w.range}
            </div>
            <div className="mt-1 text-sm text-white/85 italic">{w.context}</div>

            <div className="mt-7 text-[10px] tracking-widest uppercase text-white/65">
              You are
            </div>
            <div className="mt-1 text-3xl sm:text-4xl font-extrabold tracking-tightest text-palate-red leading-tight">
              {w.persona}
            </div>
            <div className="mt-2 text-sm italic text-white/85">"{w.tagline}"</div>

            <div className="mt-7 grid grid-cols-3 gap-2">
              {w.stats.map((s) => (
                <div key={s.l} className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <div className="text-lg font-extrabold">{s.v}</div>
                  <div className="text-[10px] uppercase tracking-widest text-white/60 mt-0.5">{s.l}</div>
                </div>
              ))}
            </div>

            <div className="mt-7 text-[10px] tracking-widest uppercase text-white/65">Top spots</div>
            <ol className="mt-2 space-y-1.5 text-sm">
              {w.topSpots.map((s, idx) => (
                <li key={s.name} className="flex justify-between border-b border-white/10 pb-1.5">
                  <span>
                    <span className="text-white/45 mr-2">{idx + 1}</span>
                    {s.name}
                  </span>
                  <span className="text-white/65">{s.count}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Right: insight */}
        <div className="flex flex-col justify-between rounded-3xl border border-palate-line bg-white p-8 sm:p-10">
          <div>
            <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
              The read
            </div>
            <p className="mt-4 text-2xl sm:text-[28px] font-medium tracking-tightish leading-snug text-palate-ink">
              {w.insight}
            </p>
          </div>
          <div className="mt-10 flex items-center justify-between">
            <button
              onClick={() => setI((cur) => Math.max(0, cur - 1))}
              disabled={i === 0}
              className="rounded-full border border-palate-line w-11 h-11 flex items-center justify-center text-xl text-palate-ink hover:bg-palate-soft disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Previous week"
            >
              ←
            </button>
            <div className="text-xs text-palate-mute font-semibold tracking-widest uppercase">
              {i + 1} of {WEEKS.length}
            </div>
            <button
              onClick={() => setI((cur) => Math.min(WEEKS.length - 1, cur + 1))}
              disabled={i === WEEKS.length - 1}
              className="rounded-full border border-palate-line w-11 h-11 flex items-center justify-center text-xl text-palate-ink hover:bg-palate-soft disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Next week"
            >
              →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
