"use client";

import { useEffect } from "react";

/**
 * Initializes posthog-js once on the client when NEXT_PUBLIC_POSTHOG_KEY
 * is set. Safe to render unconditionally — it's a no-op without the key.
 *
 * The init is dynamic-imported so the posthog bundle is only fetched on
 * pages that actually use it (and never during SSR).
 */
export function AnalyticsBoot() {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;

    let cancelled = false;
    (async () => {
      try {
        const mod = await import("posthog-js");
        if (cancelled) return;
        const posthog = mod.default;
        // Avoid double-init across HMR / route changes.
        if (typeof window !== "undefined" && !window.posthog) {
          posthog.init(key, {
            api_host:
              process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
            // Cookieless by default — flip to 'localStorage+cookie' once we
            // have a real CMP. See palate/LAWYER_REVIEW.md.
            persistence: "memory",
            capture_pageview: true,
            autocapture: false,
          });
          // Expose for the analytics shim.
          window.posthog = posthog;
        }
      } catch {
        // Network or import failure — analytics must never break the app.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
