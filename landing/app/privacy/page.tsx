import Link from "next/link";
import { Logo } from "@/components/Logo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — Palate",
  description:
    "How Palate handles your data. Short version: we don't sell it, you can wipe it anytime.",
};

export default function PrivacyPage() {
  return (
    <>
      <header className="border-b border-palate-line">
        <div className="max-w-3xl mx-auto px-6 h-[80px] flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Palate home">
            <Logo size={28} />
            <span className="text-xl font-semibold tracking-tightish">palate</span>
          </Link>
          <Link href="/" className="text-sm text-palate-mute hover:text-palate-ink">
            ← Home
          </Link>
        </div>
      </header>

      <main id="main" className="max-w-3xl mx-auto px-6 py-16">
        <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
          Privacy
        </div>
        <h1 className="mt-3 text-4xl sm:text-5xl font-semibold tracking-tightest">
          Privacy policy
        </h1>
        <p className="mt-3 text-palate-mute">
          Last updated: April 2026. Plain-English version below; the full policy follows.
        </p>

        <div className="mt-10 rounded-2xl bg-palate-soft p-6 sm:p-8 border border-palate-line">
          <h2 className="text-lg font-semibold">The 30-second version</h2>
          <ul className="mt-3 space-y-2 text-palate-ink leading-relaxed list-disc pl-5">
            <li>
              We collect the location of restaurants and food spots you visit — only because you confirmed it with a tap.
            </li>
            <li>
              We never sell or share your data with restaurants, advertisers, or other companies.
            </li>
            <li>
              You can pause tracking any time and delete everything in two taps. "Delete" really deletes.
            </li>
            <li>We don't run ads, ever. The plan is a small future subscription.</li>
            <li>No public profile, no friends, no comments. Palate is just for you.</li>
          </ul>
        </div>

        <h2 className="mt-12 text-2xl font-semibold tracking-tightish">1. What we collect</h2>
        <p className="mt-3 leading-relaxed text-palate-ink">
          When you create an account we store your email address. When you confirm a visit, we store the restaurant identifier (from Google Places), the timestamp, and an inferred meal type (breakfast, lunch, dinner). When the app checks for nearby places, we send your latitude and longitude to our server to call Google Places — we do not log raw GPS to your account in v1.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">2. What we don't collect</h2>
        <p className="mt-3 leading-relaxed text-palate-ink">
          We don't collect your name, phone number, photos, contacts, calendar, microphone, or activity in other apps. We don't fingerprint your device. We don't use third-party advertising or behavioral tracking SDKs.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">3. How we use your data</h2>
        <p className="mt-3 leading-relaxed text-palate-ink">
          Only to (a) show you the spot you just confirmed in your own visit history, and (b) generate your weekly Wrapped. That's it.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">4. Who we share it with</h2>
        <p className="mt-3 leading-relaxed text-palate-ink">
          No one. Restaurants don't see your email or that you visited. We use Supabase (database) and Google (Places lookups, location only — Google does not get your account info). We do not run third-party analytics SDKs in the app. The landing page uses Plausible analytics, which is privacy-friendly and uses no cookies or persistent identifiers.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">5. Your controls</h2>
        <p className="mt-3 leading-relaxed text-palate-ink">
          In Settings: pause tracking (no new data is recorded), delete a single visit, delete this week, or delete your entire account. Deletion is hard-deletion — no soft-delete, no 30-day "trash". Once you confirm, it's gone and unrecoverable.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">6. Data export</h2>
        <p className="mt-3 leading-relaxed text-palate-ink">
          You can request a JSON export of every visit, location event, and Wrapped we've ever generated for you. Email{" "}
          <a className="text-palate-red underline" href="mailto:privacy@palate.app">
            privacy@palate.app
          </a>
          ; we respond within 30 days.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">7. Security</h2>
        <p className="mt-3 leading-relaxed text-palate-ink">
          All traffic is HTTPS. The database enforces row-level security: a user literally cannot read another user's visits, even with a SQL bug in our app. The Google Places API key never touches your phone — it lives only on our server.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">8. Children</h2>
        <p className="mt-3 leading-relaxed text-palate-ink">
          Palate is not directed at children under 13 and we do not knowingly collect data from them. If you believe we have, email{" "}
          <a className="text-palate-red underline" href="mailto:privacy@palate.app">
            privacy@palate.app
          </a>{" "}
          and we will delete it.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">9. Changes</h2>
        <p className="mt-3 leading-relaxed text-palate-ink">
          If we materially change this policy, we'll email registered users at least 14 days before the change takes effect. You'll always have the option to delete your account before the new policy applies.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">10. Contact</h2>
        <p className="mt-3 leading-relaxed text-palate-ink">
          Questions or requests:{" "}
          <a className="text-palate-red underline" href="mailto:privacy@palate.app">
            privacy@palate.app
          </a>
          .
        </p>

        <p className="mt-12 text-sm text-palate-mute">
          This page is a placeholder pending lawyer review. It's a faithful description of the engineering reality but should be reviewed before public launch.
        </p>
      </main>

      <footer className="border-t border-palate-line mt-16">
        <div className="max-w-3xl mx-auto px-6 py-10 text-sm text-palate-mute flex flex-col sm:flex-row justify-between gap-3">
          <span>© 2026 Palate</span>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-palate-ink">Home</Link>
            <Link href="/terms" className="hover:text-palate-ink">Terms</Link>
            <Link href="/press" className="hover:text-palate-ink">Press</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
