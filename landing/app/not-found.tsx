import Link from "next/link";
import { Logo } from "@/components/Logo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Not found — Palate",
};

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <Logo size={56} />
      <h1 className="mt-8 text-5xl sm:text-6xl font-semibold tracking-tightest">
        That page is <span className="text-palate-red">off the menu.</span>
      </h1>
      <p className="mt-4 text-palate-mute max-w-md">
        We couldn't find what you were looking for. It might have moved, or you might have followed a stale link.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex rounded-full bg-palate-ink text-white px-5 py-3 text-sm font-semibold hover:opacity-90"
      >
        Back to home
      </Link>
    </main>
  );
}
