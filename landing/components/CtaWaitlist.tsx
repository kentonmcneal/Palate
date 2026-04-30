"use client";

import { useEffect, useState } from "react";
import { joinWaitlist } from "@/lib/waitlist";
import { track } from "@/lib/analytics";
import { captureRefFromUrl } from "@/lib/referral";

export function CtaWaitlist({ initialCount: _initialCount }: { initialCount?: number } = {}) {
  // initialCount is accepted for API symmetry with HeroWaitlist; this form
  // doesn't display the count, but keeping the prop avoids surprises if a
  // future variant wants to.
  void _initialCount;

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>(
    "We'll only email about Palate. Unsubscribe anytime.",
  );
  const [referredBy, setReferredBy] = useState<string | null>(null);

  useEffect(() => { setReferredBy(captureRefFromUrl()); }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value || !value.includes("@")) {
      setStatus("error");
      setMessage("That email looks off. Try again?");
      return;
    }
    setStatus("loading");
    const result = await joinWaitlist(value, "landing-cta", referredBy);
    if (!result.ok) {
      setStatus("error");
      setMessage(
        "Something went wrong. Email us at hello@palate.app and we'll add you manually.",
      );
      return;
    }
    setStatus("success");
    setMessage(
      "We'll email you in late summer when iOS testing opens. Until then, nothing else.",
    );
    setEmail("");
    track("waitlist_joined", { source: "cta", referred_by: referredBy ?? "direct" });
  }

  const labelClass =
    status === "error"
      ? "mt-3 text-sm text-palate-red"
      : status === "success"
        ? "mt-3 text-sm text-palate-ink"
        : "mt-3 text-sm text-palate-mute";

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="mt-6 max-w-md flex items-center bg-white border border-palate-line rounded-full pl-6 pr-2 py-2 shadow-card focus-within:shadow-cardHover transition-shadow"
        noValidate
        aria-label="Join the waitlist"
      >
        <label htmlFor="cta-email" className="sr-only">
          Email address
        </label>
        <input
          id="cta-email"
          type="email"
          name="email"
          required
          aria-required="true"
          autoComplete="email"
          inputMode="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 bg-transparent outline-none text-base placeholder-palate-mute py-2"
        />
        <button
          type="submit"
          disabled={status === "loading" || status === "success"}
          className="rounded-full bg-palate-red text-white font-semibold px-5 h-11 hover:opacity-90 disabled:opacity-60"
        >
          {status === "loading"
            ? "…"
            : status === "success"
              ? "On the list"
              : "Join"}
        </button>
      </form>
      <div
        className={labelClass}
        role={status === "error" ? "alert" : undefined}
        aria-live={status === "error" || status === "success" ? "polite" : undefined}
      >
        {message}
      </div>
    </>
  );
}
