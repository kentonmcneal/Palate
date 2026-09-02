// ============================================================================
// a11y.ts — Dynamic Type support.
// ----------------------------------------------------------------------------
// Reported by a tester's mother, who runs her iPhone at a large text size: the
// app "looks weird". It did. Nothing in the codebase acknowledged font scaling.
//
// React Native's <Text> scales with the system setting by DEFAULT, which sounds
// like we were fine and is exactly why we weren't. The text grew and everything
// around it didn't:
//
//   • fixed-height buttons and chips (height: 52, 36, 32) clipped their labels
//   • the tab bar's 84pt height cut off five wrapped labels
//   • rows of [name | match chip | Save] squeezed the name to nothing
//   • ~50 numberOfLines truncations that are fine at 100% and brutal at 235%
//
// Two tools here, used for different things:
//
//   CAPS — how far a given class of text is allowed to scale. Content (a
//   restaurant name, a blurb) scales all the way: that is the point of the
//   setting, and someone who needs 200% text needs it on the words that carry
//   meaning. CHROME (button labels, chips, tab bar) is capped, because past a
//   point those stop being more readable and start being clipped, which is
//   less readable. Capping chrome is what buys content the room to grow.
//
//   useFontScale() — lets a layout change SHAPE, not just size. A row that
//   works at 100% should become a column at 200% rather than compressing into
//   three unreadable columns.
//
// iOS ships accessibility sizes up to 310%. We test the shape at 2x.
// ============================================================================

import { useWindowDimensions } from "react-native";

/**
 * Ceilings on the system font multiplier, by role.
 *
 * These are NOT a way to keep the design tidy. Every one of them exists because
 * the element has a bounded box that cannot grow, and clipped text helps nobody.
 * If you find yourself wanting a cap on body copy, fix the container instead.
 */
export const FONT_CAP = {
  /** Button labels, chips, badges — bounded pills. */
  chrome: 1.4,
  /** Tab bar labels: five across a fixed-width bar. Tightest budget in the app. */
  tabBar: 1.2,
  /** Numbers inside a pill (match %, counts) — the pill grows, but not forever. */
  badge: 1.5,
  /** Section eyebrows, already uppercase and small. */
  eyebrow: 1.6,
} as const;

/** Above this, single-line rows should stack instead of compressing. */
export const STACK_THRESHOLD = 1.3;

/** Above this, decorative extras (glyphs, secondary chips) should stand down
 *  to give the text that matters the whole width. */
export const DECLUTTER_THRESHOLD = 1.6;

export type FontScaleInfo = {
  /** The raw system multiplier (1 = default, ~3.1 = largest accessibility size). */
  scale: number;
  /** Rows should become columns. */
  stack: boolean;
  /** Drop non-essential ornament. */
  declutter: boolean;
};

/**
 * Live font scale. Re-renders when the user changes the setting, which they do
 * from Control Center without leaving the app.
 */
export function useFontScale(): FontScaleInfo {
  const { fontScale } = useWindowDimensions();
  const scale = fontScale || 1;
  return {
    scale,
    stack: scale >= STACK_THRESHOLD,
    declutter: scale >= DECLUTTER_THRESHOLD,
  };
}

/**
 * Scale a fixed dimension along with the text it wraps, up to a ceiling.
 * Use for minHeight so a control grows with its label instead of clipping it.
 */
export function scaleSpace(base: number, scale: number, cap = 1.6): number {
  return Math.round(base * Math.min(scale, cap));
}
