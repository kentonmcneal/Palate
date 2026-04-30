import Link from "next/link";
import Image from "next/image";
import { Logo } from "@/components/Logo";
import { MobileDrawer } from "@/components/MobileDrawer";
import { HeroWaitlist } from "@/components/HeroWaitlist";
import { CtaWaitlist } from "@/components/CtaWaitlist";
import { CookieBanner } from "@/components/CookieBanner";
import { AppStoreBadge } from "@/components/AppStoreBadge";
import { PalateQuiz } from "@/components/PalateQuiz";
import { StickyQuizCta } from "@/components/StickyQuizCta";
import { getWaitlistCount } from "@/lib/waitlist";

// Revalidate the home page (and the embedded count) every 60s.
export const revalidate = 60;

const SECTION_NAV = [
  { href: "#how", label: "How it works" },
  { href: "#personalities", label: "Personalities" },
  { href: "#privacy", label: "Privacy" },
  { href: "#faq", label: "FAQ" },
];

const CATEGORIES = [
  { emoji: "☕", label: "Coffee" },
  { emoji: "🥐", label: "Bakery" },
  { emoji: "🌮", label: "Tacos" },
  { emoji: "🍕", label: "Pizza" },
  { emoji: "🥗", label: "Fast casual" },
  { emoji: "🍔", label: "Burgers" },
  { emoji: "🍜", label: "Noodles" },
  { emoji: "🍣", label: "Sushi" },
  { emoji: "🍷", label: "Date night" },
  { emoji: "🍺", label: "Bars" },
  { emoji: "🚗", label: "Drive-thru" },
  { emoji: "🥞", label: "Brunch" },
  { emoji: "🧋", label: "Boba" },
  { emoji: "🍦", label: "Dessert" },
  { emoji: "🍱", label: "Lunch spots" },
];

const PERSONALITIES = [
  {
    emoji: "🏆",
    title: "The Loyalist",
    sub: "If a place is good, why fix it?",
    desc: "You eat at the same 3 spots like clockwork.",
  },
  {
    emoji: "🧭",
    title: "The Explorer",
    sub: "Three new spots a week, minimum.",
    desc: "You haven't been to the same place twice in a month.",
  },
  {
    emoji: "🥗",
    title: "The Fast Casual Regular",
    sub: "Healthy-ish, fast, on the way home.",
    desc: "Your week runs on bowls and counter service.",
  },
  {
    emoji: "☕",
    title: "The Café Dweller",
    sub: "Latte before Slack.",
    desc: "Five out of seven mornings start the same way.",
  },
  {
    emoji: "🍕",
    title: "The Comfort Food Connoisseur",
    sub: "Pizza is a personality trait.",
    desc: "You eat what you actually want, and we love that for you.",
  },
];

const FAQS = [
  {
    q: "How is Palate different from Beli, Yelp, or Resy?",
    a: "Those apps measure your <em>opinions</em> — what you'd recommend, how you'd rate it. Palate measures your <em>patterns</em> — where you actually keep going. They're complementary, not competitive. Palate is the part those apps don't have.",
  },
  {
    q: "Will Palate kill my battery?",
    a: "No. Palate only uses location when you open the app and tap to log a visit. Nothing runs in the background today, so there's no measurable battery impact. (Optional background detection is on the roadmap and will be opt-in.)",
  },
  {
    q: "How accurate is finding the right place?",
    a: "Very good for sit-down spots; pretty good for fast casual; sometimes wrong for big food courts or dense streets. That's why we always ask before saving — and let you pick the right place.",
  },
  {
    q: "Is it free?",
    a: "Free during beta. We'll share details on long-term plans before anything changes — there'll always be a free tier.",
  },
  {
    q: "What about Android?",
    a: "Coming after iOS. We want one platform polished before splitting focus.",
  },
  {
    q: "Why does Palate ask before saving?",
    a: "Because walking past a restaurant isn't the same as eating there. One tap from you is the only way to know for sure — and it keeps the data honest.",
  },
  {
    q: "What does Palate do with my location?",
    a: 'We use it only to find what\'s near you when you\'re considering a meal. We never share location with restaurants or sell it. You can pause or wipe it anytime. Read the <a href="/privacy" class="text-palate-red underline">full policy</a>.',
  },
];

function ChevronSvg() {
  return (
    <svg
      className="chev w-5 h-5 text-palate-mute"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 8 l5 5 5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SmallLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#FF3008" />
      <rect x="19" y="14" width="7" height="38" rx="3.5" fill="#fff" />
      <path d="M 26 16 H 36 a 12 12 0 0 1 0 24 H 26 Z" fill="#fff" />
      <circle cx="34" cy="28" r="4" fill="#FF3008" />
    </svg>
  );
}

export default async function Page() {
  const waitlistCount = await getWaitlistCount();

  return (
    <>
      {/* ============== NAV ============== */}
      <header className="border-b border-palate-line sticky top-0 bg-white/90 backdrop-blur z-40">
        <div className="max-w-7xl mx-auto px-6 h-[80px] flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Palate home">
            <Logo size={32} />
            <span className="text-xl font-semibold tracking-tightish">palate</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-palate-ink" aria-label="Primary">
            {SECTION_NAV.map((item) => (
              <a key={item.href} href={item.href} className="hover:text-palate-red">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <a
              href="#waitlist"
              className="hidden sm:inline-flex rounded-full bg-palate-ink text-white px-5 py-2.5 text-sm font-semibold hover:opacity-90"
            >
              Get early access
            </a>
            <MobileDrawer />
          </div>
        </div>
      </header>

      <main id="main">
      {/* ============== HERO ============== */}
      <section className="bg-white">
        <div className="max-w-7xl mx-auto px-6 pt-20 pb-12 text-center">
          <span className="inline-block rounded-full bg-palate-soft text-palate-ink px-3 py-1 text-xs font-semibold tracking-wider uppercase">
            Coming soon · iOS
          </span>
          <h1 className="mt-6 text-5xl sm:text-6xl lg:text-[80px] font-semibold tracking-tightest leading-[1.02] max-w-4xl mx-auto">
            See what you<br />
            <span className="text-palate-red">actually</span> eat.
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-palate-mute max-w-2xl mx-auto leading-relaxed">
            Your eating habits have a pattern. Palate tells you what it means.
          </p>
          <p className="mt-3 text-sm text-palate-mute max-w-xl mx-auto">
            Not what you say you like. What your behavior proves.
          </p>

          <a
            href="#quiz"
            className="mt-8 inline-flex items-center gap-1 text-sm font-semibold text-palate-red hover:underline"
          >
            Find your starter Palate in 30 seconds ↓
          </a>

          <HeroWaitlist initialCount={waitlistCount} />
        </div>

        {/* Hero cards grid */}
        <div className="max-w-7xl mx-auto px-6 pb-24">
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Card 1: animated phone demo */}
            <div className="rounded-3xl border border-palate-line bg-white p-6 ease-card card-hover">
              <div className="flex justify-center py-4" aria-hidden="true">
                <div className="mini-phone">
                  <div className="mini-screen">
                    <div className="mini-notch"></div>
                    <div
                      className="px-4 pt-10 demo-cycle relative"
                      style={{ height: "calc(100% - 2.5rem)" }}
                    >
                      {/* State 1 */}
                      <div className="demo-state s1">
                        <div className="flex items-center gap-2">
                          <SmallLogo />
                          <span className="font-semibold tracking-tightish">palate</span>
                        </div>
                        <div className="mt-5 rounded-2xl bg-palate-soft p-4">
                          <div className="text-[10px] font-bold text-palate-mute tracking-widest">
                            RIGHT NOW
                          </div>
                          <div className="text-base font-bold mt-1 leading-snug">
                            Are you eating somewhere?
                          </div>
                          <div className="text-xs text-palate-mute mt-1">
                            Tap to check what's around you.
                          </div>
                          <div className="mt-3 w-full bg-palate-red text-white text-sm font-semibold rounded-full h-9 flex items-center justify-center">
                            Check now
                          </div>
                        </div>
                        <div className="mt-5">
                          <div className="text-base font-bold">Recent</div>
                          <div className="flex items-center gap-2 py-2 border-b border-palate-line">
                            <div className="w-2 h-2 rounded-full bg-palate-red"></div>
                            <div className="text-xs">
                              <div className="font-semibold">Sweetgreen</div>
                              <div className="text-palate-mute">Tue · 12:34 PM</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 py-2 border-b border-palate-line">
                            <div className="w-2 h-2 rounded-full bg-palate-red"></div>
                            <div className="text-xs">
                              <div className="font-semibold">Joe &amp; The Juice</div>
                              <div className="text-palate-mute">Tue · 9:02 AM</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* State 2 */}
                      <div className="demo-state s2 px-1 flex flex-col">
                        <div className="text-[10px] font-bold text-palate-mute tracking-widest">
                          CONFIRM VISIT
                        </div>
                        <div className="mt-2 rounded-2xl border border-palate-line p-4">
                          <div className="text-xs text-palate-mute">
                            We think you're at
                          </div>
                          <div className="mt-1 text-lg font-bold tracking-tightish leading-snug">
                            Joe's Pizza
                          </div>
                          <div className="mt-1 text-xs text-palate-mute">
                            Bleecker St · 0.02 mi
                          </div>
                        </div>
                        <div className="mt-3 text-sm font-bold">Are you eating here?</div>
                        <div className="mt-3 w-full bg-palate-red text-white text-sm font-semibold rounded-full h-10 flex items-center justify-center">
                          Yes, save it
                        </div>
                        <div className="mt-2 w-full bg-white border border-palate-line text-sm font-medium rounded-full h-10 flex items-center justify-center">
                          Wrong restaurant
                        </div>
                        <div className="mt-2 w-full bg-white text-palate-mute text-sm font-medium rounded-full h-10 flex items-center justify-center">
                          Not now
                        </div>
                      </div>

                      {/* State 3 */}
                      <div className="demo-state s3">
                        <div className="text-[10px] font-bold text-palate-mute tracking-widest">
                          SUNDAY
                        </div>
                        <div
                          className="mt-2 rounded-2xl overflow-hidden text-white relative"
                          style={{
                            background: "linear-gradient(135deg,#1A1A1A,#0E0E0E)",
                            padding: "18px",
                          }}
                        >
                          <div className="glow-r"></div>
                          <div className="relative">
                            <div className="text-[9px] tracking-widest uppercase opacity-70">
                              You are
                            </div>
                            <div className="text-[22px] font-extrabold tracking-tightest text-palate-red leading-tight">
                              The Loyalist
                            </div>
                            <div className="mt-3 grid grid-cols-3 gap-1.5">
                              <div className="rounded-lg bg-white/5 border border-white/10 p-1.5">
                                <div className="text-sm font-bold">18</div>
                                <div className="text-[8px] uppercase opacity-70">visits</div>
                              </div>
                              <div className="rounded-lg bg-white/5 border border-white/10 p-1.5">
                                <div className="text-sm font-bold">4</div>
                                <div className="text-[8px] uppercase opacity-70">places</div>
                              </div>
                              <div className="rounded-lg bg-white/5 border border-white/10 p-1.5">
                                <div className="text-sm font-bold">78%</div>
                                <div className="text-[8px] uppercase opacity-70">repeat</div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 w-full bg-palate-red text-white text-sm font-semibold rounded-full h-10 flex items-center justify-center">
                          Share my Wrapped
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-2">
                <div className="text-base font-semibold">A 3-second flow</div>
                <p className="text-palate-mute text-sm mt-1 leading-relaxed">
                  Tap → confirm → see your week. No reviews, no ratings, no photos.
                </p>
              </div>
            </div>

            {/* Card 2: "What you say vs What you do" — light treatment, no dark gradient */}
            <div className="rounded-3xl border border-palate-line bg-white p-6 ease-card card-hover flex flex-col">
              <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
                The gap
              </div>
              <h3 className="mt-3 text-2xl font-semibold tracking-tightish leading-snug">
                What you say vs what you do.
              </h3>
              <div className="mt-6 space-y-4 flex-1">
                <div className="rounded-2xl bg-palate-soft border border-palate-line px-5 py-4">
                  <div className="text-[10px] font-semibold text-palate-mute tracking-widest uppercase mb-1">
                    What you say
                  </div>
                  <p className="text-palate-ink text-[15px] leading-snug line-through opacity-65">
                    "I eat out maybe twice a week. Mostly cook at home."
                  </p>
                </div>
                <div className="rounded-2xl bg-palate-red/5 border border-palate-red/30 px-5 py-4">
                  <div className="text-[10px] font-semibold text-palate-red tracking-widest uppercase mb-1">
                    What your behavior proves
                  </div>
                  <p className="text-palate-ink text-[15px] leading-snug font-medium">
                    5.9 times. <span className="text-palate-red">$73 this week.</span> 18 different spots.
                  </p>
                </div>
              </div>
              <div className="mt-6">
                <div className="text-base font-semibold">The honest mirror</div>
                <p className="text-palate-mute text-sm mt-1 leading-relaxed">
                  Most people guess wrong about themselves. Palate doesn't.
                </p>
              </div>
            </div>

            {/* Card 3: "How patterns become personality" — light, transformation flow */}
            <div className="rounded-3xl border border-palate-line bg-white p-6 ease-card card-hover flex flex-col">
              <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
                The translation
              </div>
              <h3 className="mt-3 text-2xl font-semibold tracking-tightish leading-snug">
                Patterns become personality.
              </h3>
              <div className="mt-8 space-y-5 flex-1">
                {/* Step 1: visits */}
                <div className="flex items-center gap-4">
                  <div className="flex gap-1 flex-shrink-0">
                    {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                      <span
                        key={i}
                        className={`w-2.5 h-2.5 rounded-full ${i < 5 ? "bg-palate-red" : "bg-palate-line"}`}
                      />
                    ))}
                  </div>
                  <div className="text-sm text-palate-ink">
                    <span className="font-semibold">5 visits this week</span>
                    <div className="text-palate-mute text-xs">3× Sweetgreen, 2× Cava</div>
                  </div>
                </div>
                <div className="flex justify-center text-palate-mute text-lg">↓</div>
                {/* Step 2: pattern detected */}
                <div className="rounded-2xl border border-palate-line bg-palate-soft px-5 py-4">
                  <div className="text-[10px] font-semibold text-palate-mute tracking-widest uppercase mb-1">
                    Pattern
                  </div>
                  <p className="text-sm text-palate-ink">
                    Healthy + fast + intentional. Repeat-rate 60%.
                  </p>
                </div>
                <div className="flex justify-center text-palate-mute text-lg">↓</div>
                {/* Step 3: identity */}
                <div className="rounded-2xl border-2 border-palate-red bg-white px-5 py-4 text-center">
                  <div className="text-[10px] font-semibold text-palate-red tracking-widest uppercase mb-1">
                    Your Palate
                  </div>
                  <p className="text-xl font-extrabold tracking-tightish text-palate-red">
                    The Fast Casual Regular
                  </p>
                </div>
              </div>
              <div className="mt-6">
                <div className="text-base font-semibold">From data to identity</div>
                <p className="text-palate-mute text-sm mt-1 leading-relaxed">
                  We turn what you do into who you are, every Sunday.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============== INTERACTIVE QUIZ ============== */}
      <section id="quiz" className="bg-palate-soft border-y border-palate-line">
        <div className="max-w-3xl mx-auto px-6 py-24">
          <div className="text-center max-w-xl mx-auto">
            <div className="text-xs font-semibold text-palate-red tracking-widest uppercase">
              30-second preview
            </div>
            <h2 className="mt-3 text-3xl sm:text-5xl font-semibold tracking-tightest leading-tight">
              What's your <span className="text-palate-red">starter Palate?</span>
            </h2>
            <p className="mt-4 text-palate-mute">
              Three taps. No signup required. The real one comes after a week of actual visits — but here's a glimpse of how it feels.
            </p>
          </div>
          <div className="mt-12">
            <PalateQuiz />
          </div>
        </div>
      </section>

      {/* ============== CATEGORY STRIP ============== */}
      <section className="border-y border-palate-line bg-white">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="h-scroll">
            {CATEGORIES.map((c) => (
              <div
                key={c.label}
                className="flex flex-col items-center gap-1 px-3 py-1 cursor-default opacity-80 hover:opacity-100"
              >
                <span className="text-2xl leading-none">{c.emoji}</span>
                <span className="text-xs font-medium text-palate-mute">{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============== HOOK STAT ============== */}
      <section className="bg-white">
        <div className="max-w-5xl mx-auto px-6 py-24 text-center">
          <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
            A reality check
          </div>
          <h2 className="mt-3 text-4xl sm:text-6xl font-semibold tracking-tightest leading-[1.05]">
            The average American eats out{" "}
            <span className="text-palate-red">5.9× a week.</span>
          </h2>
          <p className="mt-5 text-2xl sm:text-3xl font-medium text-palate-ink">
            That's <span className="text-palate-red font-bold">$3,800 a year.</span> On takeout.
          </p>
          <p className="mt-5 text-lg text-palate-mute max-w-xl mx-auto">
            Most people guess two or three. Palate shows you the real number — and what it adds up to.
          </p>
        </div>
      </section>

      {/* ============== DARK MOMENT — patterns vs opinions ============== */}
      <section className="relative overflow-hidden text-white">
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(135deg,#1A1A1A,#0E0E0E)" }}
          aria-hidden="true"
        />
        <div className="glow-r absolute -top-32 -right-32 w-[480px] h-[480px]" aria-hidden="true" />
        <div className="relative max-w-4xl mx-auto px-6 py-32 sm:py-40 text-center">
          <div className="text-[11px] font-semibold tracking-widest uppercase text-white/55">
            The whole point
          </div>
          <p className="mt-6 text-4xl sm:text-6xl font-semibold tracking-tightest leading-[1.05]">
            Most apps want your <span className="text-white/40">opinion.</span>
            <br />
            Palate just wants <span className="text-palate-red">your week.</span>
          </p>
          <p className="mt-8 text-white/70 text-lg max-w-xl mx-auto leading-relaxed">
            No reviews. No followers. No public profile. Just a quiet record of where you actually
            went, and a personality reveal every Sunday.
          </p>
        </div>
      </section>

      {/* ============== HOW IT WORKS ============== */}
      <section id="how" className="bg-palate-soft">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
              How it works
            </div>
            <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tightest">
              Three steps to your taste identity.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6 mt-12">
            <Step
              n={1}
              title="We see where you actually eat"
              body="You tap once when you arrive. Palate captures the spot, the time, the format — no check-ins, no photos, no rating anything."
            />
            <Step
              n={2}
              title="We find the patterns in your behavior"
              body={
                <>
                  Repeats. New spots. Time-of-day rhythms. The cuisines you keep returning to. The lane you live in <em>and</em> the lane you drift into.
                </>
              }
            />
            <Step
              n={3}
              title="We translate that into a clear identity"
              body="Every Sunday morning, your week becomes a personality reveal — and a card you'll actually want to share."
            />
          </div>
          <p className="mt-10 text-center text-lg sm:text-xl font-medium tracking-tightish text-palate-ink">
            Not what you say you like. <span className="text-palate-red">What your behavior proves.</span>
          </p>
        </div>
      </section>

      {/* ============== SAMPLE WRAPPED GALLERY ============== */}
      <section className="bg-white">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
              Sample Wrapped
            </div>
            <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tightest">
              Four real weeks. Four different identities.
            </h2>
            <p className="mt-3 text-palate-mute">
              The same data — restaurant visits — read four different ways. Same person, different week, different read.
            </p>
          </div>
          <div className="mt-12 grid md:grid-cols-2 gap-6">
            <SampleWrapped
              title="The Convenience Loyalist"
              tagline="Speed and familiarity, no thinking required."
              stats={[
                { v: "9", l: "visits" },
                { v: "2", l: "places" },
                { v: "89%", l: "repeat" },
              ]}
              listLabel="Top spots"
              items={[
                { n: "1", name: "McDonald's", count: "×6" },
                { n: "2", name: "Starbucks", count: "×3" },
              ]}
              body="You leaned heavily on consistency this week. Six visits to McDonald's say you prioritize speed, familiarity, and meals that require no second-guessing — that's not a rut, that's a system."
            />
            <SampleWrapped
              title="The Flavor Loyalist"
              tagline="You know what you want, and you go get it."
              stats={[
                { v: "7", l: "visits" },
                { v: "3", l: "places" },
                { v: "67%", l: "repeat" },
              ]}
              listLabel="Top spots"
              items={[
                { n: "1", name: "Burger King", count: "×3" },
                { n: "2", name: "Popeyes", count: "×2" },
                { n: "3", name: "Five Guys", count: "×2" },
              ]}
              body="You showed a clear preference for bold, flame-grilled flavors. This wasn't convenience — you had a specific craving and you fed it three different ways."
            />
            <SampleWrapped
              title="The Practical Variety Seeker"
              tagline="You eat a little bit of everything — on purpose."
              stats={[
                { v: "11", l: "visits" },
                { v: "8", l: "places" },
                { v: "27%", l: "repeat" },
              ]}
              listLabel="Across the week"
              items={[
                { n: "·", name: "Sweetgreen", count: "healthy" },
                { n: "·", name: "Panda Express", count: "indulgent" },
                { n: "·", name: "Joe's Pizza", count: "comfort" },
              ]}
              body="You balanced convenience, comfort, and variety this week. You moved between healthy bowls, fast food, and bold takeout without sticking to one lane — that's not indecision, that's range."
            />
            <SampleWrapped
              title="The Fast Casual Regular"
              tagline="Healthy-ish, fast, on the way."
              stats={[
                { v: "12", l: "visits" },
                { v: "7", l: "places" },
                { v: "42%", l: "repeat" },
              ]}
              listLabel="Top spots"
              items={[
                { n: "1", name: "Sweetgreen", count: "×4" },
                { n: "2", name: "Cava", count: "×3" },
                { n: "3", name: "Joe & The Juice", count: "×2" },
              ]}
              body="You optimize for speed without giving up the plot. Bowls and counter service across Sweetgreen, Cava, and Joe & The Juice — efficient, but intentional."
            />
          </div>
        </div>
      </section>

      {/* ============== PERSONALITIES ============== */}
      <section id="personalities" className="bg-palate-soft">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
                Personalities
              </div>
              <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tightest">
                Which one are you?
              </h2>
              <p className="mt-2 text-palate-mute">Five archetypes. You'll find out at the end of your first week.</p>
            </div>
            <div className="text-sm text-palate-mute">Swipe →</div>
          </div>

          <div className="gallery-wrap mt-10">
            <div className="h-scroll -mx-6 px-6">
              {PERSONALITIES.map((p) => (
                <div
                  key={p.title}
                  className="w-[320px] rounded-3xl border border-palate-line bg-white p-7 ease-card card-hover"
                >
                  <div className="text-4xl">{p.emoji}</div>
                  <div className="mt-5 text-2xl font-extrabold tracking-tightest text-palate-red leading-tight">
                    {p.title}
                  </div>
                  <div className="mt-1 text-sm font-medium text-palate-ink">{p.sub}</div>
                  <p className="mt-3 text-palate-mute text-[15px] leading-relaxed">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ============== WHY PALATE ============== */}
      <section className="bg-white">
        <div className="max-w-3xl mx-auto px-6 py-24 text-center">
          <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
            Why Palate
          </div>
          <h2 className="mt-3 text-3xl sm:text-5xl font-semibold tracking-tightest leading-tight">
            Other apps measure your <em className="not-italic text-palate-mute">opinions.</em><br />
            Palate measures your <span className="text-palate-red">patterns.</span>
          </h2>
          <p className="mt-6 text-palate-mute text-lg leading-relaxed">
            No reviews to write. No followers to grow. No feed to scroll.
            Just a quiet record of where you actually went, and a personality reveal every Sunday morning.
          </p>
        </div>
      </section>

      {/* ============== PRIVACY ============== */}
      <section id="privacy" className="bg-palate-soft">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
              Privacy
            </div>
            <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tightest">
              Your data, your call.
            </h2>
            <p className="mt-3 text-palate-mute">
              Palate is for <em>you</em>. There's no public profile, no friends, no comments. We don't sell your data and we don't show ads.
            </p>
          </div>
          <div className="grid md:grid-cols-4 gap-4 mt-10">
            <PrivacyCard title="Pause anytime" body="Switch off location with one tap. Past visits stay; nothing new is recorded." />
            <PrivacyCard title="Delete what you want" body="Single visits, a week, or every byte we have on you." />
            <PrivacyCard title="No selling. Ever." body="Restaurants don't see your name or email. We don't share or sell." />
            <PrivacyCard title="No social anything" body="No feed, no followers, no likes. Just you and your week." />
          </div>
          <div className="mt-8">
            <Link href="/privacy" className="text-sm font-semibold text-palate-red hover:underline">
              Read the full privacy policy →
            </Link>
          </div>
        </div>
      </section>

      {/* ============== FAQ ============== */}
      <section id="faq" className="bg-palate-soft border-t border-palate-line">
        <div className="max-w-3xl mx-auto px-6 py-24">
          <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">FAQ</div>
          <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tightest">
            Things you might be wondering.
          </h2>
          <div className="mt-10 divide-y divide-palate-line border-t border-b border-palate-line bg-white rounded-2xl px-2">
            {FAQS.map((f) => (
              <details key={f.q} className="py-5 px-4 group">
                <summary className="flex justify-between items-center gap-6">
                  <span className="font-semibold text-lg">{f.q}</span>
                  <ChevronSvg />
                </summary>
                <p
                  className="mt-3 text-palate-mute leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: f.a }}
                />
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ============== ROADMAP ============== */}
      <section className="bg-white">
        <div className="max-w-5xl mx-auto px-6 py-24">
          <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">What's next</div>
          <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tightest">
            Coming soon: see how your <span className="text-palate-red">Palate</span> compares.
          </h2>
          <p className="mt-4 text-palate-mute max-w-2xl">
            Identity is interesting on its own. It gets more interesting when you see how it stacks up against the people, the city, and the patterns around you — privately, on your terms.
          </p>
          <div className="mt-10 grid md:grid-cols-3 gap-6">
            <RoadmapCard
              eyebrow="Now"
              eyebrowAccent
              title="Your weekly identity"
              body="Tap-to-log visits, Sunday Wrapped, persona reveal. iOS first."
            />
            <RoadmapCard
              eyebrow="Next"
              title="See how your Palate compares"
              body="How your week stacks up against your friends who opt in. What patterns your city has. Where your taste is rare."
            />
            <RoadmapCard
              eyebrow="Later"
              title="Year in Palate"
              body="A December reveal of your year in restaurants — a card you'll text someone."
            />
          </div>
          <p className="mt-8 text-sm text-palate-mute">
            Comparison is opt-in, anonymous, and never on a public feed. No followers. No likes. No leaderboard.
          </p>
        </div>
      </section>

      {/* ============== FOUNDER NOTE ============== */}
      <section className="bg-palate-soft">
        <div className="max-w-4xl mx-auto px-6 py-24">
          <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
            A note from the founder
          </div>
          <div className="mt-8 grid sm:grid-cols-[120px_1fr] gap-6 sm:gap-8 items-start">
            <div className="rounded-2xl overflow-hidden border border-palate-line bg-white aspect-square w-[120px] relative">
              <Image
                src="/founder.jpg"
                alt="Kenton McNeal, founder of Palate"
                fill
                sizes="120px"
                className="object-cover"
              />
            </div>
            <div>
              <p className="text-2xl sm:text-3xl font-medium tracking-tightish leading-snug">
                I built Palate because I had no idea I went to Sweetgreen{" "}
                <span className="text-palate-red">fourteen times</span> last month. Not because I love it — because it was on the way. We deserve to see our patterns honestly. McDonald's counts. Coffee counts. The fancy place counts. All of it.
              </p>
              <p className="mt-6 text-palate-mute">
                — Kenton McNeal · Wharton MBA &apos;26 ·{" "}
                <Link href="/about" className="text-palate-red hover:underline">
                  read the whole story
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============== FINAL CTA ============== */}
      <section id="waitlist" className="bg-white">
        <div className="max-w-5xl mx-auto px-6 py-24">
          <div className="rounded-3xl border border-palate-line bg-white p-10 sm:p-14 shadow-card">
            <div className="grid lg:grid-cols-2 gap-10 items-center">
              <div>
                <div className="text-xs font-semibold text-palate-red tracking-widest uppercase">
                  Early access
                </div>
                <h2 className="mt-3 text-3xl sm:text-5xl font-semibold tracking-tightest leading-tight">
                  Be among the first to see your Palate Wrapped.
                </h2>
                <p className="mt-4 text-palate-mute">
                  Join the waitlist and we'll send you an invite when iOS testing opens up.{" "}
                  <span className="text-palate-ink font-medium">That's the only email you'll get.</span>
                </p>
                <CtaWaitlist initialCount={waitlistCount} />
              </div>
              <div className="flex justify-center">
                <div
                  className="relative rounded-2xl overflow-hidden text-white"
                  style={{
                    background: "linear-gradient(135deg,#1A1A1A,#0E0E0E)",
                    width: "280px",
                    padding: "24px",
                  }}
                >
                  <div className="glow-r"></div>
                  <div className="relative">
                    <div className="text-[10px] tracking-widest uppercase opacity-70">You are</div>
                    <div className="text-2xl font-extrabold tracking-tightish text-palate-red leading-tight">
                      The Loyalist
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-1.5">
                      <div className="rounded-xl bg-white/5 border border-white/10 p-2">
                        <div className="text-base font-bold">18</div>
                        <div className="text-[9px] uppercase tracking-widest opacity-70">visits</div>
                      </div>
                      <div className="rounded-xl bg-white/5 border border-white/10 p-2">
                        <div className="text-base font-bold">4</div>
                        <div className="text-[9px] uppercase tracking-widest opacity-70">places</div>
                      </div>
                      <div className="rounded-xl bg-white/5 border border-white/10 p-2">
                        <div className="text-base font-bold">78%</div>
                        <div className="text-[9px] uppercase tracking-widest opacity-70">repeat</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      </main>

      {/* ============== FOOTER ============== */}
      <footer className="border-t border-palate-line bg-white">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="grid md:grid-cols-5 gap-10">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2.5">
                <Logo size={32} />
                <span className="text-xl font-semibold tracking-tightish">palate</span>
              </div>
              <p className="mt-3 text-palate-mute text-sm max-w-sm leading-relaxed">
                A taste-identity system. Made for you, not for the algorithm.
              </p>
              <AppStoreBadge href="#waitlist" className="mt-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">Product</div>
              <ul className="mt-3 space-y-2 text-sm text-palate-mute">
                <li><a className="hover:text-palate-ink" href="#how">How it works</a></li>
                <li><a className="hover:text-palate-ink" href="#personalities">Personalities</a></li>
                <li><a className="hover:text-palate-ink" href="#faq">FAQ</a></li>
              </ul>
            </div>
            <div>
              <div className="text-sm font-semibold">Company</div>
              <ul className="mt-3 space-y-2 text-sm text-palate-mute">
                <li><Link className="hover:text-palate-ink" href="/about">About</Link></li>
                <li><Link className="hover:text-palate-ink" href="/press">Press</Link></li>
                <li><a className="hover:text-palate-ink" href="mailto:hello@palate.app">Contact</a></li>
              </ul>
            </div>
            <div>
              <div className="text-sm font-semibold">Legal</div>
              <ul className="mt-3 space-y-2 text-sm text-palate-mute">
                <li><Link className="hover:text-palate-ink" href="/privacy">Privacy</Link></li>
                <li><Link className="hover:text-palate-ink" href="/terms">Terms</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-6 border-t border-palate-line flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-palate-mute">
            <span>© 2026 Palate. All rights reserved.</span>
            <span>Made with care · No ads · No selling · No social anything</span>
          </div>
        </div>
      </footer>

      <CookieBanner />
      <StickyQuizCta />
    </>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white border border-palate-line p-7 ease-card card-hover">
      <div className="w-9 h-9 rounded-full bg-palate-red text-white font-bold flex items-center justify-center">
        {n}
      </div>
      <h3 className="mt-5 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-palate-mute leading-relaxed text-[15px]">{body}</p>
    </div>
  );
}

function PrivacyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-palate-line bg-white p-6 ease-card card-hover">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-palate-mute text-[15px] leading-relaxed">{body}</p>
    </div>
  );
}


function RoadmapCard({
  eyebrow,
  eyebrowAccent,
  title,
  body,
}: {
  eyebrow: string;
  eyebrowAccent?: boolean;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-palate-line p-6 ease-card card-hover">
      <div
        className={`text-xs uppercase tracking-widest font-semibold ${
          eyebrowAccent ? "text-palate-red" : "text-palate-mute"
        }`}
      >
        {eyebrow}
      </div>
      <h3 className="mt-2 font-semibold text-lg">{title}</h3>
      <p className="mt-2 text-palate-mute text-[15px] leading-relaxed">{body}</p>
    </div>
  );
}

function SampleWrapped({
  title,
  tagline,
  stats,
  listLabel,
  items,
  body,
}: {
  title: string;
  tagline: string;
  stats: { v: string; l: string }[];
  listLabel: string;
  items: { n: string; name: string; count: string }[];
  body: string;
}) {
  return (
    <div className="rounded-3xl border border-palate-line bg-white p-6 ease-card card-hover">
      <div className="flex justify-center">
        <div
          className="relative rounded-2xl overflow-hidden text-white"
          style={{
            background: "linear-gradient(135deg,#1A1A1A,#0E0E0E)",
            width: "100%",
            maxWidth: "320px",
            padding: "22px",
          }}
        >
          <div className="glow-r"></div>
          <div className="relative">
            <div className="text-[10px] tracking-widest uppercase opacity-70">You are</div>
            <div className="text-2xl font-extrabold tracking-tightish text-palate-red leading-tight">
              {title}
            </div>
            <div className="mt-1 text-[12px] italic opacity-85 leading-snug">
              "{tagline}"
            </div>
            <div className="mt-4 grid grid-cols-3 gap-1.5">
              {stats.map((s) => (
                <div
                  key={s.l}
                  className="rounded-xl bg-white/5 border border-white/10 p-2"
                >
                  <div className="text-base font-bold">{s.v}</div>
                  <div className="text-[9px] uppercase tracking-widest opacity-70">{s.l}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 text-[10px] tracking-widest uppercase opacity-70">{listLabel}</div>
            <ol className="mt-1.5 space-y-1 text-[12px]">
              {items.map((item) => (
                <li
                  key={item.name}
                  className="flex justify-between border-b border-white/10 pb-1"
                >
                  <span>
                    <span className="opacity-50 mr-1.5">{item.n}</span>
                    {item.name}
                  </span>
                  <span className="opacity-70">{item.count}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      <p className="mt-5 text-[15px] leading-relaxed text-palate-ink">
        {body}
      </p>
    </div>
  );
}
