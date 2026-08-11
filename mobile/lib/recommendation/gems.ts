// ============================================================================
// recommendation/gems.ts — the "gems-first" recommendation policy.
// ----------------------------------------------------------------------------
// We STORE every restaurant, but we only RECOMMEND gems: hard-to-find,
// high-quality, Instagrammable, or upscale. This module holds the two levers:
//
//   1. isRecIneligible()  — a HARD gate: fast food, quick-service, and chains
//      never appear in recommendations (they still get stored + classified).
//   2. gemAdjustment()    — a strong ranking boost/penalty from the objective
//      signals on every venue (rating quadrant, price, aesthetic vibe, acclaim),
//      so genuine gems rise to the top and ordinary-but-real places fall to the
//      bottom as fallback.
// ============================================================================

import type { RestaurantInput } from "./types";

// NOTE: intentionally NOT keying off the classifier's "quick_service"
// format_class — the classifier assigns that to ANY price_level<=1 venue as a
// proxy, which would wrongly hard-exclude cheap independent gems (taquerias,
// banh mi, dumpling counters). Real fast food is caught by Google's explicit
// types below + chain_name, not by price.
const FAST_FORMATS = new Set(["fast_food", "fast food", "meal_takeaway"]);
const CAFE_FORMATS = new Set(["café", "cafe", "bakery", "dessert", "coffee_shop"]);
// Raw Google Places types (available pre-classification).
const GOOGLE_FAST_TYPES = new Set(["fast_food_restaurant", "meal_takeaway", "meal_delivery"]);
const GOOGLE_CAFE_TYPES = new Set(["cafe", "coffee_shop", "bakery"]);

function googleTypes(r: RestaurantInput): string[] {
  return [r.primary_type ?? "", ...(r.types ?? [])].map((t) => t.toLowerCase());
}

// Aesthetic / "Instagrammable" signals (vibe or free-form tag).
const AESTHETIC = new Set([
  "aesthetic", "instagrammable", "romantic", "rooftop", "scenic", "view",
  "design-forward", "trendy", "chic", "great-ambiance", "great-ambience",
  "date-night", "speakeasy", "patio", "waterfront", "stylish",
]);

// Critical acclaim / discovery signals.
const ACCLAIM: Record<string, number> = {
  michelin: 12,
  "james-beard": 10,
  "bib-gourmand": 8,
  "hidden-gem": 8,
  "critically-acclaimed": 6,
  "celebrity-chef": 5,
  "local-favorite": 3,
};
const ANTI: Record<string, number> = {
  "tourist-heavy": -8,
  "chain": -10,
  "fast-casual": -5,
  "high-traffic": -2,
};

export function isCafeFormat(r: RestaurantInput): boolean {
  if (CAFE_FORMATS.has((r.format_class ?? "").toLowerCase())) return true;
  return googleTypes(r).some((t) => GOOGLE_CAFE_TYPES.has(t));
}

/**
 * HARD gate — never recommend. Fast food / quick-service by format, anything
 * with a chain name, or a venue the classifier explicitly scored as a poor
 * discovery candidate. A NULL eligibility (unclassified) is NOT excluded — it
 * falls through to ranking as fallback.
 */
export function isRecIneligible(r: RestaurantInput): boolean {
  const fmt = (r.format_class ?? "").toLowerCase();
  if (FAST_FORMATS.has(fmt)) return true;
  if (googleTypes(r).some((t) => GOOGLE_FAST_TYPES.has(t))) return true;
  if (r.chain_name) return true;
  if (r.recommendation_eligibility != null && r.recommendation_eligibility < 0.5) return true;
  return false;
}

function hasAesthetic(r: RestaurantInput): boolean {
  const vibe = (r.vibe ?? "").toLowerCase();
  if (AESTHETIC.has(vibe)) return true;
  return (r.tags ?? []).some((t) => AESTHETIC.has(t.toLowerCase()));
}

// Quality-that's-hard-to-find: reward the high-rating × moderate-review-count
// quadrant; a huge review count reads as mainstream/tourist, not a gem.
function qualityQuadrant(r: RestaurantInput): number {
  const rating = r.rating ?? 0;
  const count = r.user_rating_count ?? 0;
  let s = 0;
  if (rating >= 4.6) s += 10;
  else if (rating >= 4.4) s += 6;
  else if (rating >= 4.2) s += 2;
  else if (rating > 0 && rating < 3.9) s -= 6;

  if (count >= 150 && count <= 2500) s += 6;      // sweet spot — proven, not swamped
  else if (count >= 40 && count < 150) s += 3;    // under the radar
  else if (count > 8000) s -= 4;                  // tourist magnet
  else if (count > 0 && count < 40) s -= 2;       // too unproven
  return s;
}

function priceUpscale(r: RestaurantInput): number {
  switch (r.price_level) {
    case 4: return 10;
    case 3: return 7;
    case 2: return 2;
    case 1: return -8; // cheap eats / fast-casual correlate
    default: return 0;
  }
}

function tagSignal(r: RestaurantInput): number {
  let s = 0;
  for (const t of r.tags ?? []) {
    const k = t.toLowerCase();
    s += ACCLAIM[k] ?? ANTI[k] ?? 0;
  }
  return s;
}

/**
 * Strong ranking adjustment (roughly [-25, +32]) layered onto finalScore so
 * gems dominate the top of the feed and ordinary places sink to fallback.
 */
export function gemAdjustment(r: RestaurantInput): number {
  const adj = qualityQuadrant(r) + priceUpscale(r) + (hasAesthetic(r) ? 8 : 0) + tagSignal(r);
  return Math.max(-25, Math.min(32, adj));
}

/** A venue that clears a real gem bar — used to let an exceptional café through. */
export function isGem(r: RestaurantInput): boolean {
  return gemAdjustment(r) >= 12;
}
