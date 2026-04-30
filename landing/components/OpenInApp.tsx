"use client";

import { track } from "@/lib/analytics";

/**
 * "Open in app" button — primarily for users coming from a TestFlight
 * invite who already have the app installed.
 *
 * Strategy: try the `palate://` URL scheme. If the app is installed, iOS
 * captures the navigation and the page is hidden. If it isn't, the
 * navigation silently fails — after a 1.5s timeout we redirect to the
 * fallback (App Store once we have an ID, the waitlist for now).
 *
 * Non-iOS devices skip the deep-link attempt entirely and go straight to
 * the fallback — there's no point trying a URL scheme that can't resolve.
 */

function PhoneArrow() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Phone outline */}
      <rect x="6" y="3" width="12" height="18" rx="2" ry="2" />
      {/* Outgoing arrow */}
      <path d="M14 8l3-3" />
      <path d="M17 5h3v3" />
    </svg>
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function OpenInApp({
  scheme = "palate://open",
  fallbackUrl = "#waitlist",
  className = "",
}: {
  scheme?: string;
  fallbackUrl?: string;
  className?: string;
}) {
  function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    try {
      track("open_in_app_clicked");
    } catch {
      // analytics must never break the click
    }

    if (!isIos()) {
      window.location.href = fallbackUrl;
      return;
    }

    // Try to open the app. If the scheme is unhandled, iOS just does nothing
    // — the page stays visible and our timer fires. If it IS handled, the
    // page becomes hidden / unloaded before the timer runs.
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;

    function clearTimer() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        // App probably opened — cancel the fallback.
        clearTimer();
      }
    }

    document.addEventListener("visibilitychange", onVisibility);

    timer = setTimeout(() => {
      document.removeEventListener("visibilitychange", onVisibility);
      // If we were backgrounded for the deep-link, skip the fallback.
      if (document.visibilityState === "hidden") return;
      // Sanity check: if the timer fired way late (browser throttled it
      // because the tab WAS hidden), don't yank the user to the App Store.
      if (Date.now() - start > 3000) return;
      window.location.href = fallbackUrl;
    }, 1500);

    // Kick off the deep link.
    window.location.href = scheme;
  }

  return (
    <a
      href={fallbackUrl}
      onClick={onClick}
      className={`as-badge as-badge-outline ${className}`}
      aria-label="Open Palate in the app"
    >
      <PhoneArrow />
      <span>
        <span className="as-eyebrow block">IF YOU HAVE</span>
        <span className="as-name">Open in app</span>
      </span>
    </a>
  );
}
