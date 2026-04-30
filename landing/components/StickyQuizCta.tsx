"use client";

import { useEffect, useState } from "react";

// ============================================================================
// StickyQuizCta — bottom-right floating pill that captures visitors who
// scroll past the hero without taking the quiz. Hides itself once the user
// reaches the quiz section, the FAQ, or the footer (so it doesn't compete
// with on-page CTAs that are already visible).
// ============================================================================

const SHOW_AFTER_PX = 800;

export function StickyQuizCta() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    function onScroll() {
      if (typeof window === "undefined") return;
      const y = window.scrollY;
      const showByScroll = y > SHOW_AFTER_PX;

      // Hide if any of these in-page anchors are in view (the user can already
      // see a CTA that's part of the page flow).
      const hideAt = ["quiz", "waitlist", "faq"]
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null);
      const anyVisible = hideAt.some((el) => {
        const rect = el.getBoundingClientRect();
        return rect.top < window.innerHeight * 0.8 && rect.bottom > 0;
      });

      setShow(showByScroll && !anyVisible);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <a
      href="#quiz"
      aria-label="Take the 30-second Palate quiz"
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-palate-red text-white px-5 py-3 text-sm font-semibold shadow-card hover:opacity-90 transition-all duration-300 ${
        show
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 translate-y-4 pointer-events-none"
      }`}
    >
      Find your Palate · 30 sec →
    </a>
  );
}
