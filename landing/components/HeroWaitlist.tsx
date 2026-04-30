"use client";

import { useState } from "react";
import { joinWaitlist } from "@/lib/waitlist";
import { track } from "@/lib/analytics";

export function HeroWaitlist({ initialCount = 352 }: { initialCount?: number }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [count, setCount] = useState(initialCount);
  const [position, setPosition] = useState<number | null>(null);
  const [copyText, setCopyText] = useState("Copy link");

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
    const result = await joinWaitlist(value, "landing-hero");
    if (!result.ok) {
      setStatus("error");
      setMessage(
        "Something went wrong. Email us at hello@palate.app and we'll add you manually.",
      );
      return;
    }
    const newCount = count + 1;
    setCount(newCount);
    // Position = count + 1 (the spec: their slot in line). Earlier code added
    // jitter; we now use the canonical position.
    setPosition(newCount);
    setStatus("success");
    track("waitlist_joined", { source: "hero" });
  }

  function shareOnX() {
    const url = encodeURIComponent("https://palate.app");
    const text = encodeURIComponent(
      "I just joined the waitlist for Palate — a weekly Wrapped of what you actually eat. Curious to see mine.",
    );
    window.open(
      `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
      "_blank",
      "noopener",
    );
    track("share_click", { method: "twitter" });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText("https://palate.app");
      setCopyText("Copied");
    } catch {
      setCopyText("Couldn't copy");
    }
    setTimeout(() => setCopyText("Copy link"), 2000);
    track("share_click", { method: "copy" });
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
              Skip 50 spots when 3 friends sign up via your link.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="mt-10 max-w-xl mx-auto flex items-center bg-white border border-palate-line rounded-full pl-6 pr-2 py-2 shadow-card focus-within:shadow-cardHover transition-shadow"
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
            <span className="font-semibold text-palate-ink">
              {count.toLocaleString()}
            </span>{" "}
            people on the list · Free during beta · No spam, ever
          </>
        )}
      </div>
    </>
  );
}
