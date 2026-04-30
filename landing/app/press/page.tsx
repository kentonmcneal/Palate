import Link from "next/link";
import { Logo } from "@/components/Logo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Press — Palate",
  description: "Press kit for Palate, the weekly taste-identity app. Pitch, fact sheet, logos, contact.",
};

const FACTS = [
  { label: "Founded", value: "2026" },
  { label: "Headquartered", value: "Philadelphia, PA · Memphis-raised founder" },
  { label: "Platforms", value: "iOS (beta) · Android on roadmap" },
  { label: "Price", value: "Free during beta · always a free tier" },
  { label: "Category", value: "Food · Lifestyle · Quantified-self" },
  { label: "Identity", value: "9 distinct eating personas, revealed every Sunday" },
  { label: "Privacy", value: "No ads, no data sales, no public profiles" },
  { label: "Founder", value: "Kenton C. McNeal · Wharton MBA '26" },
];

const COLORS = [
  { name: "Palate Red", hex: "#FF3008", className: "bg-palate-red" },
  { name: "Ink", hex: "#111111", className: "bg-palate-ink" },
  { name: "Paper", hex: "#FFFFFF", className: "bg-white" },
  { name: "Soft", hex: "#F7F7F7", className: "bg-palate-soft" },
];

export default function PressPage() {
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

      <main id="main" className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
          Press kit
        </div>
        <h1 className="mt-3 text-4xl sm:text-5xl font-semibold tracking-tightest">
          For journalists & creators
        </h1>
        <p className="mt-4 text-lg text-palate-mute max-w-2xl">
          Everything you need to write about Palate: a 30-second pitch, fact sheet, logos, and screenshots. For interviews or anything not here, email{" "}
          <a className="text-palate-red underline" href="mailto:press@palate.app">
            press@palate.app
          </a>
          .
        </p>

        <h2 className="mt-14 text-2xl font-semibold tracking-tightish">The 30-second pitch</h2>
        <p className="mt-3 leading-relaxed text-palate-ink max-w-3xl">
          Palate is a privacy-first iOS app that turns your real eating week into a taste identity. One tap when you arrive somewhere, and every Sunday you get a personality reveal — The Convenience Loyalist, The Explorer, The Café Dweller, and six others. There's no public profile, no following, no reviews. The bet: most people radically underestimate how often and where they actually eat, and a clear identity is more useful than another rating system.
        </p>
        <p className="mt-4 leading-relaxed text-palate-mute max-w-3xl italic">
          Other apps measure your opinions. Palate measures your patterns.
        </p>

        <h2 className="mt-14 text-2xl font-semibold tracking-tightish">Fact sheet</h2>
        <div className="mt-5 grid sm:grid-cols-2 gap-4">
          {FACTS.map((f) => (
            <div key={f.label} className="rounded-2xl border border-palate-line p-6">
              <div className="text-xs uppercase tracking-widest text-palate-mute font-semibold">
                {f.label}
              </div>
              <div className="mt-2 text-lg font-medium">{f.value}</div>
            </div>
          ))}
        </div>

        <h2 className="mt-14 text-2xl font-semibold tracking-tightish">Logos</h2>
        <p className="mt-3 text-palate-mute">
          Right-click → save. Use the red mark on light backgrounds and the white mark on dark.
        </p>
        <div className="mt-5 grid sm:grid-cols-3 gap-4">
          <a
            href="/favicon.svg"
            download
            className="rounded-2xl border border-palate-line p-8 flex flex-col items-center gap-3 hover:bg-palate-soft"
          >
            <Logo size={80} />
            <div className="text-sm font-semibold">Mark · red</div>
            <div className="text-xs text-palate-mute">SVG · 64×64</div>
          </a>
          <div className="rounded-2xl bg-palate-ink p-8 flex flex-col items-center gap-3">
            <svg
              width="80"
              height="80"
              viewBox="0 0 64 64"
              role="img"
              aria-label="Palate inverse mark"
            >
              <rect width="64" height="64" rx="16" fill="#fff" />
              <rect x="19" y="14" width="7" height="38" rx="3.5" fill="#FF3008" />
              <path d="M 26 16 H 36 a 12 12 0 0 1 0 24 H 26 Z" fill="#FF3008" />
              <circle cx="34" cy="28" r="4" fill="#fff" />
            </svg>
            <div className="text-sm font-semibold text-white">Mark · inverse</div>
            <div className="text-xs text-white/70">SVG · 64×64</div>
          </div>
          <a
            href="/og-image.png"
            download
            className="rounded-2xl border border-palate-line p-8 flex flex-col items-center gap-3 hover:bg-palate-soft"
          >
            <div className="w-full aspect-[1200/630] rounded-md overflow-hidden border border-palate-line bg-[#0E0E0E] flex items-center justify-center text-white text-xs">
              og-image.png
            </div>
            <div className="text-sm font-semibold">Social card</div>
            <div className="text-xs text-palate-mute">PNG · 1200×630</div>
          </a>
        </div>

        <h2 className="mt-14 text-2xl font-semibold tracking-tightish">Brand colors</h2>
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {COLORS.map((c) => (
            <div
              key={c.name}
              className="rounded-2xl overflow-hidden border border-palate-line"
            >
              <div className={`h-24 ${c.className}`} />
              <div className="p-3">
                <div className="font-semibold text-sm">{c.name}</div>
                <div className="text-xs text-palate-mute">{c.hex}</div>
              </div>
            </div>
          ))}
        </div>

        <h2 className="mt-14 text-2xl font-semibold tracking-tightish">Boilerplate</h2>
        <pre className="mt-3 rounded-2xl bg-palate-soft border border-palate-line p-5 text-sm leading-relaxed text-palate-ink whitespace-pre-wrap">
          Palate is a privacy-first iOS app that turns your real eating week into a taste identity. One tap when you arrive at a restaurant — and every Sunday you get a personality reveal: are you The Convenience Loyalist, The Explorer, The Comfort Connoisseur? Nine distinct identities, computed from your actual visits, never from your ratings. No public profile. No followers. No selling your data.
        </pre>

        <h2 className="mt-14 text-2xl font-semibold tracking-tightish">Contact</h2>
        <p className="mt-3 text-palate-ink">
          Press inquiries · interview requests · review copies:{" "}
          <a className="text-palate-red underline" href="mailto:press@palate.app">
            press@palate.app
          </a>{" "}
          (24-hour response).
        </p>
      </main>

      <footer className="border-t border-palate-line mt-16">
        <div className="max-w-5xl mx-auto px-6 py-10 text-sm text-palate-mute flex flex-col sm:flex-row justify-between gap-3">
          <span>© 2026 Palate</span>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-palate-ink">Home</Link>
            <Link href="/about" className="hover:text-palate-ink">About</Link>
            <Link href="/privacy" className="hover:text-palate-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-palate-ink">Terms</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
