// ============================================================================
// match-score.ts — display helpers for a match score, and distance.
// ----------------------------------------------------------------------------
// This file used to hold a SECOND, complete scoring implementation —
// `scoreMatch`, with its own weights, its own confidence model and its own
// copy of FLAVOR_WEIGHT. lib/recommendation/compatibility.ts owns all of that
// now, and `scoreMatch` had no caller outside its own test: two scorers that
// can silently disagree is how the next regression gets in, so it is gone.
//
// What remains is presentation, which thirteen files import: the colour and
// tint for a score chip, the band label, a Haversine distance and its
// formatter. Nothing here decides anything; it only renders a number somebody
// else computed.
// ============================================================================

const R_EARTH_KM = 6371;

export function distanceKm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ----------------------------------------------------------------------------
// Match score color tiers — 4-step function for instant visual hierarchy.
// 80-100 → strong red    (this is for you)
// 60-79  → lighter red   (probably for you)
// 40-59  → light gray    (neutral)
// 0-39   → gray          (probably not for you)
// ----------------------------------------------------------------------------
const STRONG_RED  = "#E5391C";
const LIGHTER_RED = "#FF8266";
const LIGHT_GRAY  = "#B5B5B5";
const GRAY        = "#8E8E8E";

/**
 * The score as a word, at the precision the model actually has.
 *
 * The card used to lead with a large glowing figure — "93 match" — which
 * asserts that 93 and 88 are meaningfully different. They are not: the score is
 * a weighted sum of attribute overlaps with a neutral 50 floor and a hand-tuned
 * personal adjustment, so a few points is noise. Four bands is the real
 * resolution, and it is the same resolution matchScoreColor has always used.
 */
export function matchBand(score: number | null | undefined): string {
  if (score == null) return "Worth a look";
  if (score >= 80) return "Strong match";
  if (score >= 60) return "Good match";
  if (score >= 40) return "Worth a look";
  return "A stretch";
}

export function matchScoreColor(score: number | null | undefined): string {
  if (score == null) return GRAY;
  if (score >= 80) return STRONG_RED;
  if (score >= 60) return LIGHTER_RED;
  if (score >= 40) return LIGHT_GRAY;
  return GRAY;
}

/** Background tint — same tier mapping, low-opacity version. */
export function matchScoreTint(score: number | null | undefined): string {
  if (score == null) return "rgba(142,142,142,0.10)";
  if (score >= 80) return "rgba(255,48,8,0.12)";
  if (score >= 60) return "rgba(255,130,102,0.12)";
  if (score >= 40) return "rgba(181,181,181,0.18)";
  return "rgba(142,142,142,0.10)";
}

/** Format a distance for display: "0.3 mi" or "5 min walk". */
export function formatDistance(km: number): string {
  const mi = km * 0.621371;
  if (mi < 0.15) return "Right here";
  if (mi < 0.5) {
    const minutes = Math.round((km * 1000) / 80); // ~80m/min walk pace
    return `${minutes} min walk`;
  }
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function shareOf(map: Record<string, number>, key: string): number {
  const total = Object.values(map).reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  return (map[key] ?? 0) / total;
}

function sumShareAcross(map: Record<string, number>, keys: string[]): number {
  const total = Object.values(map).reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  let sum = 0;
  for (const k of keys) sum += map[k] ?? 0;
  return Math.min(1, sum / total);
}

function topOf(map: Record<string, number>): string {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  return entries[0] ? humanize(entries[0][0]) : "regular";
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
