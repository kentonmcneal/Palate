// Tiny analytics shim. Branches to whichever provider is configured via
// NEXT_PUBLIC_* env vars. Public API is stable: `track(event, props?)`.
//
// Provider precedence (first match wins):
//   1. NEXT_PUBLIC_POSTHOG_KEY      → PostHog (initialized in <AnalyticsBoot />)
//   2. NEXT_PUBLIC_UMAMI_WEBSITE_ID → Umami   (script in app/layout.tsx)
//   3. NEXT_PUBLIC_PLAUSIBLE_DOMAIN → Plausible (script in app/layout.tsx)
//   4. nothing set                  → no-op
//
// Each branch is best-effort and silent: analytics must never break the app.

type Props = Record<string, unknown>;

function provider(): "posthog" | "umami" | "plausible" | "none" {
  if (process.env.NEXT_PUBLIC_POSTHOG_KEY) return "posthog";
  if (process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID) return "umami";
  if (process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN) return "plausible";
  return "none";
}

export function track(event: string, props?: Props): void {
  if (typeof window === "undefined") return;

  try {
    switch (provider()) {
      case "posthog": {
        const ph = window.posthog;
        if (ph && typeof ph.capture === "function") {
          ph.capture(event, props);
        }
        return;
      }
      case "umami": {
        const u = window.umami;
        if (u && typeof u.track === "function") {
          u.track(event, props);
        }
        return;
      }
      case "plausible": {
        const fn = window.plausible;
        if (typeof fn !== "function") return;
        if (props && Object.keys(props).length > 0) {
          fn(event, { props });
        } else {
          fn(event);
        }
        return;
      }
      case "none":
      default:
        return;
    }
  } catch {
    // Swallow — analytics must never break the app.
  }
}
