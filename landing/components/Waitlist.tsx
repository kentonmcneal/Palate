"use client";

// Legacy waitlist form. Kept for backwards-compat; new pages use HeroWaitlist
// and CtaWaitlist which share logic via @/lib/waitlist.

import { useState } from "react";
import { joinWaitlist } from "@/lib/waitlist";

export function Waitlist() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus("loading");
    setError(null);

    const result = await joinWaitlist(email, "landing");
    if (!result.ok) {
      setStatus("error");
      setError(result.message);
      return;
    }
    setStatus("success");
  }

  if (status === "success") {
    return (
      <div className="rounded-2xl border border-palate-line bg-white p-6">
        <div className="text-lg font-semibold">You're on the list.</div>
        <p className="text-palate-mute mt-1">
          We'll email you the moment Palate is ready for you.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-2" aria-label="Join the waitlist">
      <label htmlFor="legacy-waitlist-email" className="sr-only">
        Email address
      </label>
      <input
        id="legacy-waitlist-email"
        type="email"
        name="email"
        required
        aria-required="true"
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        className="flex-1 rounded-full border border-palate-line bg-white px-5 py-3 text-base outline-none focus:border-palate-red focus:ring-2 focus:ring-palate-red/20"
        disabled={status === "loading"}
      />
      <button
        type="submit"
        disabled={status === "loading"}
        className="rounded-full bg-palate-red px-6 py-3 text-white font-semibold hover:opacity-90 disabled:opacity-60"
      >
        {status === "loading" ? "Joining…" : "Join waitlist"}
      </button>
      {error && (
        <div className="text-sm text-palate-red mt-1 sm:absolute sm:mt-12" role="alert">{error}</div>
      )}
    </form>
  );
}
