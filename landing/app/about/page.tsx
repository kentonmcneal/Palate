import Link from "next/link";
import Image from "next/image";
import { Logo } from "@/components/Logo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — Palate",
  description:
    "Meet the founder of Palate — a Memphis-raised, Wharton MBA building a privacy-first weekly Wrapped of your real eating life.",
};

export default function AboutPage() {
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
          About
        </div>
        <h1 className="mt-3 text-4xl sm:text-5xl font-semibold tracking-tightest">
          The person behind Palate.
        </h1>

        {/* ============== FOUNDER ============== */}
        <section className="mt-14 grid md:grid-cols-[280px_1fr] gap-10 items-start">
          <div className="rounded-3xl overflow-hidden border border-palate-line bg-palate-soft aspect-[3/4] relative">
            <Image
              src="/founder.jpg"
              alt="Kenton C. McNeal, founder of Palate"
              fill
              priority
              sizes="(max-width: 768px) 100vw, 280px"
              className="object-cover"
            />
          </div>
          <div>
            <div className="text-xs font-semibold text-palate-red tracking-widest uppercase">
              Founder
            </div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tightish">Kenton C. McNeal</h2>
            <p className="mt-2 text-palate-mute">Founder, Palate · Wharton MBA &apos;26 · Memphis-raised</p>

            <div className="mt-8 space-y-5 text-[17px] leading-relaxed text-palate-ink">
              <p>
                I grew up in Memphis, where food is its own love language. I graduated Valedictorian of Overton High
                School and trained classically on piano there for seven years — the discipline of practicing the same
                eight bars until they sound right shows up in everything I&apos;ve built since.
              </p>
              <p>
                From Memphis I went to Morehouse College, graduating <em>summa cum laude</em> in Psychology with the
                Class of 2020. Four years at Deloitte Consulting followed, leading strategy and operations engagements
                for Fortune 50 tech and healthcare clients. I&apos;m now finishing my MBA at The Wharton School in
                Strategic Management &amp; Entrepreneurship, fresh off a summer on Airbnb&apos;s Strategic Finance &amp;
                Analytics team.
              </p>
              <p>
                I built Palate because I had no idea I&apos;d been to Sweetgreen{" "}
                <span className="text-palate-red font-medium">fourteen times</span> last month — not because I love it,
                but because it was on the way. Most of us radically underestimate where our money, time, and attention
                actually go. McDonald&apos;s counts. Coffee counts. The fancy place counts. All of it.
              </p>
              <p>
                Palate is the app I wanted to exist. No public profile. No feed. No rating anything. Just an honest
                mirror, every Sunday morning, of the week you actually had.
              </p>
            </div>

            <div className="mt-10 flex flex-wrap gap-3">
              <a
                href="mailto:hello@palate.app"
                className="inline-flex rounded-full bg-palate-ink text-white px-5 py-2.5 text-sm font-semibold hover:opacity-90"
              >
                Get in touch
              </a>
              <a
                href="https://www.linkedin.com/in/kenton-mcneal"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-full border border-palate-line px-5 py-2.5 text-sm font-semibold hover:bg-palate-soft"
              >
                LinkedIn ↗
              </a>
            </div>
          </div>
        </section>

        {/* ============== PULL QUOTE ============== */}
        <section className="mt-20">
          <figure className="relative rounded-3xl border border-palate-line bg-palate-soft px-8 sm:px-12 py-12 sm:py-14">
            <span
              aria-hidden="true"
              className="absolute -top-6 left-8 sm:left-10 text-palate-red text-[120px] leading-none font-serif select-none"
            >
              &ldquo;
            </span>
            <blockquote className="relative text-2xl sm:text-3xl font-medium tracking-tightish leading-snug text-palate-ink">
              Your favorite restaurant isn&apos;t the one you&apos;d rank highest. It&apos;s the one you{" "}
              <span className="text-palate-red">actually keep going back to.</span>
            </blockquote>
            <figcaption className="mt-6 text-sm text-palate-mute">
              — Kenton, on why Palate has no stars, no scores, and no leaderboard
            </figcaption>
          </figure>
        </section>

        {/* ============== QUICK FACTS ============== */}
        <section className="mt-20">
          <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
            Quick facts
          </div>
          <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Fact label="Hometown" value="Memphis, Tennessee" />
            <Fact label="High school" value="Overton High School · Valedictorian" />
            <Fact label="Undergrad" value="Morehouse College &apos;20 · BA Psychology · Summa Cum Laude" />
            <Fact label="MBA" value="The Wharton School · Class of 2026" />
            <Fact label="Most recent" value="Strategic Finance & Analytics, Airbnb" />
            <Fact label="Before that" value="Strategy & Operations, Deloitte Consulting" />
            <Fact label="Trained pianist" value="Classical · 7 years" />
            <Fact label="Off-the-clock" value="Avid runner, weight lifter, food connoisseur" />
            <Fact label="Honors" value="Howard E. Mitchell Fellow · Phi Beta Kappa · UNCF Scholar" />
          </div>
        </section>

        {/* ============== WHY PALATE ============== */}
        <section className="mt-20 rounded-3xl bg-palate-soft border border-palate-line p-8 sm:p-12">
          <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
            Why Palate exists
          </div>
          <p className="mt-4 text-2xl sm:text-3xl font-medium tracking-tightish leading-snug">
            Most apps are built to perform for other people. Palate is built to be{" "}
            <span className="text-palate-red">honest with yourself.</span>
          </p>
          <p className="mt-6 text-palate-mute leading-relaxed max-w-2xl">
            No reviews to write. No followers to grow. No feed to scroll. Just a quiet record of where you actually go,
            and a personality reveal every Sunday morning. That&apos;s the whole product.
          </p>
        </section>
      </main>

      <footer className="border-t border-palate-line mt-16">
        <div className="max-w-5xl mx-auto px-6 py-10 text-sm text-palate-mute flex flex-col sm:flex-row justify-between gap-3">
          <span>© 2026 Palate</span>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-palate-ink">Home</Link>
            <Link href="/press" className="hover:text-palate-ink">Press</Link>
            <Link href="/privacy" className="hover:text-palate-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-palate-ink">Terms</Link>
          </div>
        </div>
      </footer>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-palate-line bg-white p-5">
      <div className="text-xs uppercase tracking-widest text-palate-mute font-semibold">
        {label}
      </div>
      <div className="mt-2 text-[15px] font-medium leading-snug">{value}</div>
    </div>
  );
}
