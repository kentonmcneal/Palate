import Link from "next/link";
import { Logo } from "@/components/Logo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms — Palate",
  description: "Terms of service for Palate.",
};

export default function TermsPage() {
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
        <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">Terms</div>
        <h1 className="mt-3 text-4xl sm:text-5xl font-semibold tracking-tightest">
          Terms of service
        </h1>
        <p className="mt-3 text-palate-mute">Last updated: April 2026.</p>

        <div className="mt-10 rounded-2xl bg-palate-soft p-6 sm:p-8 border border-palate-line">
          <h2 className="text-lg font-semibold">The plain-English version</h2>
          <p className="mt-2 leading-relaxed">
            By using Palate you agree to: be the actual person who signed up, use the app for personal (non-commercial) purposes, and accept that the app is provided as-is during beta. We reserve the right to change features and end the beta. We promise to give you 30 days notice and a data export before doing anything destructive.
          </p>
        </div>

        <h2 className="mt-12 text-2xl font-semibold tracking-tightish">1. Eligibility</h2>
        <p className="mt-3 leading-relaxed">
          You must be at least 13 years old to use Palate. By creating an account, you confirm you are.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">2. Your account</h2>
        <p className="mt-3 leading-relaxed">
          You are responsible for keeping your sign-in email secure. We use one-time codes / magic links, so there's no password to steal. If you suspect unauthorized access, sign out of all devices in Settings and email us.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">3. Acceptable use</h2>
        <p className="mt-3 leading-relaxed">
          Don't try to break the service, don't scrape it, and don't use it to track other people. Palate is a single-player tool; we will terminate accounts used to surveil others.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">4. The beta</h2>
        <p className="mt-3 leading-relaxed">
          Palate is in beta. Things may break, change, or disappear. We will give 30 days notice before any change that meaningfully reduces your access to your data, and we will always provide a final export.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">5. Pricing</h2>
        <p className="mt-3 leading-relaxed">
          During beta, Palate is free. We expect to launch a paid plan after beta; the free tier will continue to include weekly Wrapped and basic history. Any paid features will be announced in-app at least 30 days before launch and will never apply retroactively.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">6. Content & ownership</h2>
        <p className="mt-3 leading-relaxed">
          Your visit data belongs to you. We claim no ownership of it. The app, its design, code, and personality archetypes belong to Palate.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">7. Termination</h2>
        <p className="mt-3 leading-relaxed">
          You can delete your account anytime from Settings. We can suspend accounts that violate these terms, with email notice when feasible. On termination, your data is permanently deleted within 30 days.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">8. Disclaimers</h2>
        <p className="mt-3 leading-relaxed">
          Palate is provided "as is." Our restaurant detection is best-effort and not always accurate. We make no warranty that the service will be uninterrupted, error-free, or fit for any specific purpose.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">9. Limitation of liability</h2>
        <p className="mt-3 leading-relaxed">
          To the maximum extent permitted by law, our total liability is limited to the greater of (a) the amount you've paid us in the last 12 months, or (b) US$50.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">10. Governing law</h2>
        <p className="mt-3 leading-relaxed">
          These terms are governed by the laws of the State of California, USA. Disputes will be resolved in San Francisco County, CA.
        </p>

        <h2 className="mt-10 text-2xl font-semibold tracking-tightish">11. Contact</h2>
        <p className="mt-3 leading-relaxed">
          Questions:{" "}
          <a className="text-palate-red underline" href="mailto:hello@palate.app">
            hello@palate.app
          </a>
          .
        </p>

        <p className="mt-12 text-sm text-palate-mute">This page is a placeholder pending lawyer review.</p>
      </main>

      <footer className="border-t border-palate-line mt-16">
        <div className="max-w-3xl mx-auto px-6 py-10 text-sm text-palate-mute flex flex-col sm:flex-row justify-between gap-3">
          <span>© 2026 Palate</span>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-palate-ink">Home</Link>
            <Link href="/privacy" className="hover:text-palate-ink">Privacy</Link>
            <Link href="/press" className="hover:text-palate-ink">Press</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
