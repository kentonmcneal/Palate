"use client";

import { useEffect, useState } from "react";
import { joinWaitlist } from "@/lib/waitlist";
import { track } from "@/lib/analytics";
import { captureRefFromUrl, shareUrlFor, REFERRAL_BUMP_AT } from "@/lib/referral";

export function HeroWaitlist({ initialCount = 352 }: { initialCount?: number }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [count, setCount] = useState(initialCount);
  const [position, setPosition] = useState<number | null>(null);
  const [copyText, setCopyText] = useState("Copy referral link");
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referredBy, setReferredBy] = useState<string | null>(null);

  // Pull ?ref= from the URL on mount (and persist for later signups).
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
    setMessage(null);
    const result = await joinWaitlist(value, "landing-hero", referredBy);
    if (!result.ok) {
      setStatus("error");
      setMessage(
        "Something went wrong. Email us at hello@palate.app and we'll add you manually.",
      );
      return;
    }
    const newCount = count + 1;
    setCount(newCount);
    setPosition(newCount);
    setReferralCode(result.referralCode ?? null);
    setStatus("success");
    track("waitlist_joined", { source: "hero", referred_by: referredBy ?? "direct" });
  }

  function shareOnX() {
    const url = encodeURIComponent(
      referralCode ? shareUrlFor(referralCode) : "https://palate.app",
    );
    const text = encodeURIComponent(
      "I just joined the waitlist for Palate — a weekly Wrapped of what you actually eat. Curious to see mine.",
    );
    window.open(
      `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
      "_blank",
      "noopener",
    );
    track("share_click", { method: "twitter", with_referral: !!referralCode });
  }

  async function copyLink() {
    const link = referralCode ? shareUrlFor(referralCode) : "https://palate.app";
    try {
      await navigator.clipboard.writeText(link);
      setCopyText("Copied");
    } catch {
      setCopyText("Couldn't copy");
    }
    setTimeout(() => setCopyText("Copy referral link"), 2000);
    track("share_click", { method: "copy", with_referral: !!referralCode });
  }

  if (status === "success") {
    return (
      <div className="mt-8 max-w-xl mx-auto rounded-2xl border border-palate-line bg-palate-soft p-6 text-left">
        <div className="flex items-start gap-4">
          <div
            className="w-10 h-10 rounded-full bg-palate-red text-white flex items-center justify-center text-lg font-bold flex-shrink-0"
            aria-hidden="true"
          >
            ✓
          </div>
          <div className="flex-1">
            <div className="font-semibold text-lg">You're on the list.</div>
            <div className="text-palate-mute text-sm mt-1">
              We'll email you in late summer when iOS testing opens.{" "}
              <span className="font-medium text-palate-ink">
                Until then, nothing else.
              </span>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs uppercase tracking-widest text-palate-mute font-semibold">
                Your position:{" "}
                <span className="text-palate-red text-base">
                  #{position}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={shareOnX}
                  className="rounded-full border border-palate-line px-4 py-2 text-xs font-semibold hover:bg-white"
                >
                  Share on X
                </button>
                <button
                  type="button"
                  onClick={copyLink}
                  className="rounded-full border border-palate-line px-4 py-2 text-xs font-semibold hover:bg-white"
                >
                  {copyText}
                </button>
              </div>
            </div>
            <div className="text-xs text-palate-mute mt-2">
              Skip 50 spots when {REFERRAL_BUMP_AT} friends sign up via your link.
            </div>
            {referralCode && (
              <div className="mt-3 rounded-lg bg-white border border-palate-line px-3 py-2 text-xs font-mono text-palate-ink break-all">
                {shareUrlFor(referralCode)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Live-feeling social proof above the form */}
      <div className="mt-8 flex items-center justify-center gap-2 text-sm text-palate-mute">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-palate-red opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-palate-red" />
        </span>
        <span>
          <span className="font-semibold text-palate-ink">{count.toLocaleString()}</span>{" "}
          early eaters · joining in NYC, LA, SF, Boston, Atlanta
        </span>
      </div>

      <form
        onSubmit={onSubmit}
        className="mt-4 max-w-xl mx-auto flex items-center bg-white border border-palate-line rounded-full pl-6 pr-2 py-2 shadow-card focus-within:shadow-cardHover transition-shadow"
        noValidate
        aria-label="Join the waitlist"
      >
        <label htmlFor="hero-email" className="sr-only">
          Email address
        </label>
        <input
          id="hero-email"
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
          disabled={status === "loading"}
          className="rounded-full bg-palate-red text-white font-semibold px-6 h-12 hover:opacity-90 disabled:opacity-50"
        >
          {status === "loading" ? "…" : "Join waitlist"}
        </button>
      </form>
      <div
        className={`mt-3 text-sm ${
          status === "error" ? "text-palate-red" : "text-palate-mute"
        }`}
        role={status === "error" ? "alert" : undefined}
        aria-live={status === "error" ? "polite" : undefined}
      >
        {message ? (
          message
        ) : (
          <>
            <span className="font-semibold text-palate-ink">What you'll get:</span>{" "}
            one email when iOS testing opens. That's the only email.
          </>
        )}
      </div>
    </>
  );
}
