"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Self-dismissing privacy notice. Slides in after 1.2s, auto-fades on the
// first scroll past 200px (most visitors won't even register it), and is
// dismissable via Escape or the close button. Footer carries the persistent
// disclosure for anyone who actually wants to read it.
//
// No localStorage by design — we don't need to remember dismissal because
// the banner is non-blocking and the analytics is cookie-free anyway.
export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  // Show after a brief delay (less jarring than appearing on first paint).
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, []);

  // Auto-dismiss on first meaningful scroll — visitor's reading the page,
  // they shouldn't be blocked by a privacy notice they didn't ask about.
  useEffect(() => {
    if (!visible) return;
    function onScroll() {
      if (window.scrollY > 200) setVisible(false);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [visible]);

  // Escape to dismiss for keyboard users.
  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setVisible(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible]);

  return (
    <div
      className={`cookie-bar ${visible ? "" : "hide"}`}
      role="region"
      aria-label="Privacy notice"
      aria-hidden={!visible}
    >
      <div className="text-xs leading-relaxed flex-1 text-white/85">
        Privacy-friendly analytics — no cookies, no cross-site tracking.{" "}
        <Link href="/privacy" className="underline hover:text-white">
          Learn more
        </Link>
      </div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Dismiss privacy notice"
        className="text-white/60 hover:text-white text-base px-1 leading-none"
      >
        ×
      </button>
    </div>
  );
}
