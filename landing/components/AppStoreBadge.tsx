"use client";

import { track } from "@/lib/analytics";

function AppleSvg() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="#fff"
      aria-hidden="true"
    >
      <path d="M16.4 12.7c-.04-2.5 2-3.7 2.1-3.8-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.7 0-1.9-.9-3.2-.8-1.6 0-3.1 1-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.5.8 1.2 1.7 2.4 3 2.4 1.2 0 1.7-.8 3.2-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.5-1-2.5-3.5zM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.2-.6 2.8-1.4z" />
    </svg>
  );
}

/**
 * The "Coming soon on App Store" badge. Renders as either a non-interactive
 * label (no `href`) or a clickable link that scrolls to the waitlist and
 * fires a `app_store_clicked` analytics event.
 */
export function AppStoreBadge({
  href,
  className = "",
}: {
  href?: string;
  className?: string;
}) {
  const inner = (
    <>
      <AppleSvg />
      <span>
        <span className="as-eyebrow block">COMING SOON ON</span>
        <span className="as-name">App Store</span>
      </span>
    </>
  );

  if (!href) {
    return (
      <span
        className={`as-badge ${className}`}
        aria-label="Coming soon to the App Store"
      >
        {inner}
      </span>
    );
  }

  return (
    <a
      href={href}
      className={`as-badge ${className}`}
      aria-label="Coming soon to the App Store — join the waitlist"
      onClick={() => track("app_store_clicked")}
    >
      {inner}
    </a>
  );
}
