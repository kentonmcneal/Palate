"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Logo } from "./Logo";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#personalities", label: "Personalities" },
  { href: "#privacy", label: "Privacy" },
  { href: "#faq", label: "FAQ" },
  { href: "/about", label: "About" },
];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function MobileDrawer() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const headingId = useId();

  function close() {
    setOpen(false);
  }

  // When the drawer opens: focus the first focusable element inside the panel
  // (the close button) and trap focus there. On close, restore focus to the
  // toggle button. Escape also closes.
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Defer focus until the panel is in the DOM and visible.
    const t = window.setTimeout(() => {
      closeRef.current?.focus();
    }, 0);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to the trigger when closing.
      if (previouslyFocused && previouslyFocused !== document.body) {
        previouslyFocused.focus();
      } else {
        toggleRef.current?.focus();
      }
    };
  }, [open]);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden w-10 h-10 rounded-full border border-palate-line flex items-center justify-center"
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-drawer"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>

      <div
        id="mobile-drawer"
        className={`drawer ${open ? "open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        aria-hidden={!open}
      >
        <div
          ref={panelRef}
          className="drawer-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Logo size={28} />
              <span
                id={headingId}
                role="heading"
                aria-level={2}
                className="text-lg font-semibold tracking-tightish"
              >
                palate
              </span>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={close}
              className="w-10 h-10 rounded-full border border-palate-line flex items-center justify-center"
              aria-label="Close menu"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </svg>
            </button>
          </div>
          <nav className="mt-8 flex flex-col gap-1 text-lg font-medium" aria-label="Mobile">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={close}
                className="py-3 border-b border-palate-line"
              >
                {item.label}
              </a>
            ))}
            <Link
              href="/press"
              onClick={close}
              className="py-3 border-b border-palate-line"
            >
              Press
            </Link>
          </nav>
          <a
            href="#waitlist"
            onClick={close}
            className="mt-8 block w-full text-center rounded-full bg-palate-red text-white px-5 py-3 text-sm font-semibold hover:opacity-90"
          >
            Get early access
          </a>
        </div>
      </div>
    </>
  );
}
