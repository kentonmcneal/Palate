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
          Last updated: August 2026. Plain-English summary first; the full policy follows.
        </p>

        <div className="mt-10 rounded-2xl bg-palate-soft p-6 sm:p-8 border border-palate-line">
          <h2 className="text-lg font-semibold">The 30-second version</h2>
          <ul className="mt-3 space-y-2 text-palate-ink leading-relaxed list-disc pl-5">
            <li>
              We store the food spots you confirm with a tap, plus anything you choose to add — a profile photo, a meal photo, a name.
            </li>
            <li>
              We use your location for one thing: figuring out which restaurant you might be at. By default that only happens while the app is open. You can optionally turn on background visit logging, which lets Palate notice when you've spent time somewhere and ask you afterward whether you ate there. It's off unless you switch it on.
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
          <li><strong>Location (app open):</strong> when the app is open and checking for nearby places, we send your latitude and longitude to our server to call Google Places.</li>
          <li>
            <strong>Location (background visit logging — optional, off by default):</strong> if you turn this on, and grant iOS &ldquo;Always&rdquo; location access, your phone watches your location in the background to work out when you have stopped somewhere. That processing happens <em>on your device</em>: the app reads your position, decides whether you have settled in one place, and discards everything else. We never receive a trail of where you went, and none of it is transmitted unless a stop qualifies. Before anything leaves your device, we check it on your phone: stops shorter than 5 minutes or longer than 4 hours are discarded, low-accuracy readings are discarded, and places you visit repeatedly overnight or on a weekday routine — your home and your workplace — are filtered out. The pattern data used for that home/work filtering stays on your phone and is never sent to us. Only for a stop that survives those checks do we send the coordinates to our server to look up nearby restaurants via Google Places, then ask you whether you ate there. Nothing is added to your diary unless you confirm it, and if you dismiss or ignore the question, no visit is recorded. You can turn background logging off at any time in Settings, which stops the detection entirely.
          </li>
          <li>
            <strong>Email receipts (optional, off unless you connect it):</strong> if you connect
            Gmail in Settings, Palate requests Google&rsquo;s read-only mail permission and searches
            your inbox <em>only</em> for messages from a fixed list of restaurant, reservation and
            delivery senders (OpenTable, Resy, Tock, SevenRooms, DoorDash, Uber Eats, Grubhub,
            Caviar, Square, Yelp). We do not read, index or store your wider mailbox. From a matching
            message we keep the restaurant name and the date so the visit can appear in your diary;
            we do not store the message itself. Disconnecting in Settings deletes the stored
            credentials and revokes our access with Google, and you can also revoke it directly in
            your Google account.
          </li>
          <li><strong>Product analytics:</strong> we record basic in-app events (for example, that a permission screen was shown or a visit prompt was confirmed) in our own database so we can tell which parts of the app work. These are tied to your account; they are not sold, shared, or sent to an advertising network.</li>
          <li><strong>Social activity you opt into:</strong> friend connections, likes, and the feed events you generate or share (Wrapped, persona changes, milestones, logged visits), governed by your visibility setting.</li>
          <li><strong>Safety actions:</strong> users you block, and any content you report to us.</li>
          <li><strong>Feedback:</strong> when you send feedback in-app, the message, category, an optional screenshot, and basic technical context (app version, device model, OS version) so we can reproduce issues.</li>
          <li><strong>Notifications:</strong> a push token, if you enable notifications, so we can send your weekly Wrapped and related alerts.</li>
        </ul>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">2. What we don't collect</h2>
        <p className="mt-3 leading-relaxed text-palate-ink">
          We don't collect your phone number, contacts, calendar, microphone, or activity in other apps. We never record a continuous location trail. With background visit logging switched on, your phone reads your location to work out where you stopped, but that happens on the device — what reaches us is the stops that pass the filtering described above, never your route between them and never the readings we discard. We don't fingerprint your device, and we don't use third-party advertising or behavioral-tracking SDKs. Photos are only ever the ones you deliberately choose to add.
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
          In Settings you can pause tracking (no new data is recorded), turn background visit logging on or off at any time, set your profile visibility (private, friends, or public), manage your photos, and block or report other users. Turning background logging off stops the detection immediately; you can also revoke location access entirely in iOS Settings &rarr; Palate &rarr; Location, which has the same effect. You can delete a single visit, delete this week, or delete your entire account. Deletion is hard-deletion — no soft-delete, no 30-day "trash." Once you confirm, it's gone and unrecoverable.
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
