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
          Last updated: July 2026. Plain-English summary first; the full policy follows.
        </p>

        <div className="mt-10 rounded-2xl bg-palate-soft p-6 sm:p-8 border border-palate-line">
          <h2 className="text-lg font-semibold">The 30-second version</h2>
          <ul className="mt-3 space-y-2 text-palate-ink leading-relaxed list-disc pl-5">
            <li>
              We store the food spots you confirm with a tap, plus anything you choose to add — a profile photo, a meal photo, a name.
            </li>
            <li>
              We use your location only while the app is open, only to figure out which restaurant you might be at. We don't track you in the background.
            </li>
            <li>
              We never sell or share your data with restaurants, advertisers, or other companies.
            </li>
            <li>
              You control what's public — profile visibility, friends, and what shows in any feed are all your call. You can block or report anyone.
            </li>
            <li>
              You can pause tracking any time and delete everything in two taps. "Delete" really deletes — no ads, ever.
            </li>
          </ul>
        </div>

        <h2 className="mt-12 text-2xl font-semibold tracking-tightish">1. What we collect</h2>
        <ul className="mt-3 space-y-2 leading-relaxed text-palate-ink list-disc pl-5">
          <li><strong>Account:</strong> your email address.</li>
          <li><strong>Profile:</strong> anything you choose to add — a display name, a @username, and an optional profile photo.</li>
          <li><strong>Visits:</strong> when you confirm a visit, the restaurant identifier (from Google Places), the timestamp, an inferred meal type (breakfast/lunch/dinner), and any meal photo you choose to attach.</li>
          <li><strong>Location:</strong> when the app is open and checking for nearby places, we send your latitude and longitude to our server to call Google Places. We do not record a background location trail.</li>
          <li><strong>Social activity you opt into:</strong> friend connections, likes, and the feed events you generate or share (Wrapped, persona changes, milestones, logged visits), governed by your visibility setting.</li>
          <li><strong>Safety actions:</strong> users you block, and any content you report to us.</li>
          <li><strong>Feedback:</strong> when you send feedback in-app, the message, category, an optional screenshot, and basic technical context (app version, device model, OS version) so we can reproduce issues.</li>
          <li><strong>Notifications:</strong> a push token, if you enable notifications, so we can send your weekly Wrapped and related alerts.</li>
        </ul>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">2. What we don't collect</h2>
        <p className="mt-3 leading-relaxed text-palate-ink">
          We don't collect your phone number, contacts, calendar, microphone, or activity in other apps. We don't track your location in the background. We don't fingerprint your device, and we don't use third-party advertising or behavioral-tracking SDKs. Photos are only ever the ones you deliberately choose to add.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">3. How we use your data</h2>
        <p className="mt-3 leading-relaxed text-palate-ink">
          To show your own visit history, generate your weekly Wrapped identity read, power taste-based discovery and recommendations, run the social features you opt into, respond to your feedback and fix bugs, and keep the community safe (acting on blocks and reports). That's it.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">4. Who we share it with</h2>
        <p className="mt-3 leading-relaxed text-palate-ink">
          We don't sell your data, and restaurants never see your email or that you visited. We use a small number of infrastructure providers strictly to run the app: Supabase (our database and photo storage), Google (Places lookups — location only; Google does not receive your account info), and Expo (delivering push notifications). We use Anthropic's API to classify <em>restaurants</em>, not your personal data. We do not run third-party analytics SDKs in the app; the landing page uses Plausible, which is cookieless and privacy-friendly.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">5. Your controls</h2>
        <p className="mt-3 leading-relaxed text-palate-ink">
          In Settings you can pause tracking (no new data is recorded), set your profile visibility (private, friends, or public), manage your photos, and block or report other users. You can delete a single visit, delete this week, or delete your entire account. Deletion is hard-deletion — no soft-delete, no 30-day "trash." Once you confirm, it's gone and unrecoverable.
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
          All traffic is HTTPS. The database enforces row-level security: a user cannot read another user's visits, even given a bug in our app. Profile photos, meal photos, and feedback screenshots live in access-controlled storage. Our Google Places API key never touches your phone — it lives only on our server.
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
