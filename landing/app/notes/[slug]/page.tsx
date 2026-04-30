import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { NOTES, noteBySlug } from "@/content/notes";

export const dynamic = "force-static";

export async function generateStaticParams() {
  return NOTES.map((n) => ({ slug: n.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const note = noteBySlug(params.slug);
  if (!note) return { title: "Notes — Palate" };
  return {
    title: `${note.title} — Palate`,
    description: note.dek,
    openGraph: {
      title: note.title,
      description: note.dek,
      type: "article",
      publishedTime: note.publishedAt,
      authors: [note.author],
    },
  };
}

export default function NotePage({ params }: { params: { slug: string } }) {
  const note = noteBySlug(params.slug);
  if (!note) notFound();

  return (
    <>
      <header className="border-b border-palate-line">
        <div className="max-w-3xl mx-auto px-6 h-[80px] flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Palate home">
            <Logo size={28} />
            <span className="text-xl font-semibold tracking-tightish">palate</span>
          </Link>
          <Link href="/notes" className="text-sm text-palate-mute hover:text-palate-ink">
            ← All notes
          </Link>
        </div>
      </header>

      <main id="main" className="max-w-2xl mx-auto px-6 py-16">
        <div className="text-xs font-semibold text-palate-mute tracking-widest uppercase">
          {new Date(note.publishedAt).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
          {" · "}
          {note.readingMinutes} min read
        </div>
        <h1 className="mt-4 text-3xl sm:text-5xl font-semibold tracking-tightest leading-tight">
          {note.title}
        </h1>
        <p className="mt-4 text-palate-mute">{note.dek}</p>

        <article className="mt-10 space-y-6 text-[17px] leading-relaxed text-palate-ink">
          {note.body.map((block, i) => {
            if (typeof block === "string") {
              return <p key={i}>{block}</p>;
            }
            return (
              <h2 key={i} className="mt-10 text-2xl font-semibold tracking-tightish">
                {block.h2}
              </h2>
            );
          })}
        </article>

        <div className="mt-16 pt-8 border-t border-palate-line text-sm text-palate-mute">
          — {note.author}
        </div>

        <div className="mt-12 rounded-2xl bg-palate-soft border border-palate-line p-8 text-center">
          <h3 className="text-xl font-semibold tracking-tightish">
            Want to be early?
          </h3>
          <p className="mt-2 text-palate-mute text-sm">
            Join the waitlist. iOS first. Free during beta.
          </p>
          <Link
            href="/#waitlist"
            className="mt-5 inline-flex rounded-full bg-palate-red text-white px-5 py-2.5 text-sm font-semibold hover:opacity-90"
          >
            Join the waitlist →
          </Link>
        </div>
      </main>

      <footer className="border-t border-palate-line mt-16">
        <div className="max-w-3xl mx-auto px-6 py-10 text-sm text-palate-mute flex justify-between gap-3">
          <span>© 2026 Palate</span>
          <div className="flex gap-6">
            <Link href="/notes" className="hover:text-palate-ink">All notes</Link>
            <Link href="/about" className="hover:text-palate-ink">About</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
