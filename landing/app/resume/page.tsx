import Link from "next/link";
import { Logo } from "@/components/Logo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Resume — Kenton McNeal",
  description:
    "Kenton C. McNeal's resume. Wharton MBA '26, Memphis-raised, building Palate.",
};

const RESUME_URL = "/kenton-mcneal-resume.pdf";

export default function ResumePage() {
  return (
    <>
      <header className="border-b border-palate-line">
        <div className="max-w-5xl mx-auto px-6 h-[80px] flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Palate home">
            <Logo size={28} />
            <span className="text-xl font-semibold tracking-tightish">palate</span>
          </Link>
          <Link href="/about" className="text-sm text-palate-mute hover:text-palate-ink">
            ← About
          </Link>
        </div>
      </header>

      <main id="main" className="max-w-5xl mx-auto px-6 py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
              Resume
            </div>
            <h1 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tightest">
              Kenton C. McNeal
            </h1>
            <p className="mt-2 text-palate-mute">
              Wharton MBA &apos;26 · Memphis-raised · Founder, Palate
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href={RESUME_URL}
              download
              className="inline-flex rounded-full bg-palate-red text-white px-5 py-2.5 text-sm font-semibold hover:opacity-90"
            >
              Download PDF
            </a>
            <a
              href={RESUME_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded-full border border-palate-line px-5 py-2.5 text-sm font-semibold hover:bg-palate-soft"
            >
              Open in new tab ↗
            </a>
          </div>
        </div>

        {/* Embedded PDF — works in every modern browser. iOS Safari shows
            a fallback link if it can't inline-render. */}
        <div className="mt-10 rounded-2xl border border-palate-line overflow-hidden bg-palate-soft">
          <object
            data={`${RESUME_URL}#view=FitH&toolbar=1`}
            type="application/pdf"
            className="w-full"
            style={{ height: "1100px" }}
            aria-label="Kenton McNeal resume PDF"
          >
            <div className="p-10 text-center text-palate-mute">
              Your browser can&apos;t embed PDFs.{" "}
              <a href={RESUME_URL} className="text-palate-red underline">
                Download the resume here.
              </a>
            </div>
          </object>
        </div>
      </main>

      <footer className="border-t border-palate-line mt-16">
        <div className="max-w-5xl mx-auto px-6 py-10 text-sm text-palate-mute flex flex-col sm:flex-row justify-between gap-3">
          <span>© 2026 Palate</span>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-palate-ink">Home</Link>
            <Link href="/about" className="hover:text-palate-ink">About</Link>
            <Link href="/press" className="hover:text-palate-ink">Press</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
