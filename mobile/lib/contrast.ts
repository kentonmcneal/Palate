// ============================================================================
// contrast.ts — WCAG relative luminance and contrast ratio.
// ----------------------------------------------------------------------------
// Written because "is that readable?" was being answered by looking at it, and
// I cannot look at it. A number settles it in a test instead of in a round
// trip through a screenshot.
//
// The thresholds are WCAG 2.1: 4.5:1 for body text, 3:1 for large text
// (roughly 24px bold and up). Large-text 3:1 is a floor, not a target — the
// Wrapped story headline sat at 3.6:1 and was still hard to read on a phone at
// arm's length, which is how a rule can be met and the point missed.
// ============================================================================

/** sRGB channel to linear, per WCAG. */
function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * (n & 255 ? channel(n & 255) : channel(0))
  );
}

/** 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const WCAG = { body: 4.5, large: 3.0 } as const;
