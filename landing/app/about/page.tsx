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
            <p className="mt-2 text-palate-mute">Wharton MBA &apos;26 · Memphis-raised · Food connoisseur</p>

            <div className="mt-8 space-y-5 text-[17px] leading-relaxed text-palate-ink">
              <p>
                I grew up in Memphis, Tennessee — a city where food is a love language and a Sunday plate is sacred.
                I attended Overton High School as Valedictorian, and was classically trained in their piano program for
                seven years. That kind of discipline — show up, repeat, get a little better every week — is the same
                rhythm Palate is built on.
              </p>
              <p>
                I went on to Morehouse College, graduating <em>summa cum laude</em> with a B.A. in Psychology, then
                spent four years at Deloitte Consulting in Atlanta leading strategy and operations work for some of the
                largest tech and healthcare companies in the country. Today I&apos;m an MBA candidate at The Wharton School
                (Strategic Management &amp; Entrepreneurship), and most recently spent the summer on the Strategic Finance
                &amp; Analytics team at Airbnb.
              </p>
              <p>
                I built Palate because I had no idea I went to Sweetgreen{" "}
                <span className="text-palate-red font-medium">fourteen times</span> last month. Not because I love it —
                because it was on the way. We deserve to see our patterns honestly. McDonald&apos;s counts. Coffee counts.
                The fancy place counts. All of it.
              </p>
              <p>
                Palate is the app I wished existed: quiet, private, no public profiles, no influencer feed — just you
                and the truth of where you actually went this week.
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

        {/* ============== QUICK FACTS ============== */}
        <section className="mt-20">
          <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
            Quick facts
          </div>
          <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Fact label="Hometown" value="Memphis, Tennessee" />
            <Fact label="High school" value="Overton High School · Valedictorian" />
            <Fact label="Undergrad" value="Morehouse College · BA Psychology · Summa Cum Laude" />
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
