"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// NOTE: per spec, no localStorage / sessionStorage. This is in-memory only;
// "accept" hides the banner for the current session. A real consent service
// (Plausible doesn't need consent, but a future integration might) would
// persist this server-side or via a managed CMP.
export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, []);

  // Allow keyboard users to dismiss the banner with Escape.
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
      aria-label="Cookie notice"
      aria-hidden={!visible}
    >
      <div className="text-sm leading-relaxed flex-1">
        We use a privacy-friendly analytics tool (no cookies, no tracking
        across sites).{" "}
        <Link href="/privacy" className="underline">
          Learn more
        </Link>
        .
      </div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Dismiss cookie notice"
        className="rounded-full bg-white text-palate-ink font-semibold px-4 py-2 text-sm hover:opacity-90"
      >
        Got it
      </button>
    </div>
  );
}
