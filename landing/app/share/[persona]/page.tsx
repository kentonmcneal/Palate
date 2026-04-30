// ============================================================================
// /share/[persona] — landing page someone lands on when a friend shares
// their Starter Palate. Pre-renders with og:image, drives the visitor
// straight into the quiz to find their own.
// ============================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { STARTER_PERSONAS, type StarterPersonaKey } from "@/config/starter-personas";
import { SIGNALS } from "@/config/signals";
import type { Metadata } from "next";

// Pre-render all 5 persona pages at build time.
export const dynamic = "force-static";

export async function generateStaticParams() {
  return Object.keys(STARTER_PERSONAS).map((persona) => ({ persona }));
}

export async function generateMetadata({
  params,
}: {
  params: { persona: string };
}): Promise<Metadata> {
  const persona = STARTER_PERSONAS[params.persona as StarterPersonaKey];
  if (!persona) return { title: "Palate" };
  const ogUrl = `/api/palate-card/${params.persona}`;
  const title = `${persona.label} — My Starter Palate`;
  return {
    title,
    description: persona.tagline,
    openGraph: {
      title,
      description: persona.tagline,
      url: `/share/${params.persona}`,
      images: [{ url: ogUrl, width: 1080, height: 1080 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: persona.tagline,
      images: [ogUrl],
    },
  };
}

export default function SharePersonaPage({
  params,
}: {
  params: { persona: string };
}) {
  const persona = STARTER_PERSONAS[params.persona as StarterPersonaKey];
  if (!persona) notFound();

  const chips = persona.coreSignals.map((s) => SIGNALS[s].label);

  return (
    <>
      <header className="border-b border-palate-line">
        <div className="max-w-5xl mx-auto px-6 h-[80px] flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Palate home">
            <Logo size={28} />
            <span className="text-xl font-semibold tracking-tightish">palate</span>
          </Link>
          <Link href="/" className="text-sm text-palate-mute hover:text-palate-ink">
            ← Home
          </Link>
        </div>
      </header>

      <main id="main" className="bg-palate-soft min-h-[80vh]">
        <div className="max-w-3xl mx-auto px-6 py-20">
          <div className="text-center text-xs font-semibold text-palate-mute tracking-widest uppercase">
            A friend just shared their Palate
          </div>
          <h1 className="mt-4 text-3xl sm:text-5xl font-semibold tracking-tightest text-center leading-tight">
            They got <span className="text-palate-red">{persona.label}</span>.
          </h1>

          {/* The dark persona card */}
          <div
            className="mt-12 rounded-3xl overflow-hidden text-white relative shadow-card"
            style={{ background: "linear-gradient(135deg,#1A1A1A,#0E0E0E)" }}
          >
            <div className="glow-r" />
            <div className="relative p-10 sm:p-14 text-center">
              <div className="text-[11px] tracking-widest uppercase opacity-70">
                Their starter Palate
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
              <div className="mt-7 flex flex-wrap justify-center gap-2 max-w-md mx-auto">
                {chips.map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* CTA back to quiz */}
          <div className="mt-12 text-center">
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tightish">
              What's <span className="text-palate-red">your</span> Palate?
            </h2>
            <p className="mt-3 text-palate-mute max-w-lg mx-auto">
              30 seconds. No signup needed. 1 of 9 possible identities. Your real one builds from where you actually go.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/#quiz"
                className="inline-flex rounded-full bg-palate-red text-white px-6 py-3 text-sm font-semibold hover:opacity-90"
              >
                Find my Palate →
              </Link>
              <Link
                href="/"
                className="inline-flex rounded-full border border-palate-line bg-white px-6 py-3 text-sm font-semibold hover:bg-palate-soft"
              >
                What is Palate?
              </Link>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-palate-line">
        <div className="max-w-5xl mx-auto px-6 py-10 text-sm text-palate-mute flex flex-col sm:flex-row justify-between gap-3">
          <span>© 2026 Palate</span>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-palate-ink">Home</Link>
            <Link href="/about" className="hover:text-palate-ink">About</Link>
            <Link href="/privacy" className="hover:text-palate-ink">Privacy</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
