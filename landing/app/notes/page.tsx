import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { NOTES } from "@/content/notes";

export const metadata: Metadata = {
  title: "Notes — Palate",
  description: "Field notes from building Palate.",
};

export default function NotesIndex() {
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
          Notes
        </div>
        <h1 className="mt-3 text-4xl sm:text-5xl font-semibold tracking-tightest">
          Field notes from building Palate.
        </h1>
        <p className="mt-4 text-palate-mute">
          Short essays — what we're learning, why we're building it this way.
        </p>

        <ul className="mt-12 divide-y divide-palate-line border-y border-palate-line">
          {NOTES.map((note) => (
            <li key={note.slug}>
              <Link
                href={`/notes/${note.slug}`}
                className="block py-7 hover:bg-palate-soft px-3 -mx-3 rounded-xl transition"
              >
                <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
                  {new Date(note.publishedAt).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                  {" · "}
                  {note.readingMinutes} min read
                </div>
                <h2 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tightish leading-snug group-hover:text-palate-red">
                  {note.title}
                </h2>
                <p className="mt-2 text-palate-mute">{note.dek}</p>
              </Link>
            </li>
          ))}
        </ul>
      </main>

      <footer className="border-t border-palate-line mt-16">
        <div className="max-w-3xl mx-auto px-6 py-10 text-sm text-palate-mute flex justify-between gap-3">
          <span>© 2026 Palate</span>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-palate-ink">Home</Link>
            <Link href="/about" className="hover:text-palate-ink">About</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
