// ============================================================================
// recommendation/explanations.ts — behavior-based, specific, human reasons.
// ----------------------------------------------------------------------------
// One source of truth for every "why" string the user sees. Forbidden patterns:
//   • "rich-forward — your kind of"
//   • "popular nearby" (without context)
//   • "recommended for you"
//   • "high match"
// Every string must reference USER BEHAVIOR or a CONCRETE FACT.
//
// Format:
//   primary    — the most specific reason
//   secondary  — supporting context (distance, friends, time)
//   confidence — only surfaced when low
// ============================================================================

import type { TasteGraph } from "./taste-graph";
import type { RestaurantInput, Compatibility } from "./types";
import { shareOf } from "./taste-graph";

type DimResult = { s: number; matched: boolean };

// ----------------------------------------------------------------------------
// Compatibility reasons — used by the canonical compatibility scorer.
// Returns up to 3 strings, sorted from most specific to most general.
// ----------------------------------------------------------------------------
export function explainCompatibility(
  g: TasteGraph,
  r: RestaurantInput,
  parts: { taste: DimResult; behavior: DimResult; social: DimResult; quality: DimResult; novelty: DimResult; personalDelta: number },
): string[] {
  const out: string[] = [];

  // 1. Item ↔ cuisine cross-learning (most personal signal we have)
  if (r.cuisine_type) {
    const c = g.itemSentimentByCuisine.get(r.cuisine_type);
    if (c && c.loved >= 2) {
      out.push(`You've loved ${c.loved} ${humanize(r.cuisine_type)} dishes.`);
    } else if (c && c.not_for_me >= 2 && c.loved === 0) {
      out.push(`Note: a few ${humanize(r.cuisine_type)} dishes weren't for you.`);
    }
  }

  // 2. Friend visits — high social signal
  const friends = g.friendVisitsByPlace.get(r.google_place_id) ?? 0;
  if (friends >= 2) {
    out.push(`${friends} friends have visited.`);
  } else if (friends === 1) {
    out.push("A friend has visited.");
  }

  // 3. Cuisine pattern (the dominant taste-fit reason)
  if (parts.taste.matched && r.cuisine_subregion) {
    const share = shareOf(g.cuisinesSubregion, r.cuisine_subregion);
    if (share >= 0.25) {
      out.push(`Matches your ${humanize(r.cuisine_subregion)} pattern.`);
    } else if (share >= 0.1) {
      out.push(`Aligned with your ${humanize(r.cuisine_subregion)} preferences.`);
    }
  } else if (parts.taste.matched && r.cuisine_region) {
    out.push(`In your usual ${humanize(r.cuisine_region)} lane.`);
  }

  // 4. Format / behavior fit
  if (parts.behavior.matched && r.format_class) {
    const share = shareOf(g.formats, r.format_class);
    if (share >= 0.3) {
      out.push(`Matches your ${humanize(r.format_class)} habit.`);
    }
  }

  // 5. Occasion fit
  if (parts.behavior.matched && r.occasion_tags?.length) {
    const top = r.occasion_tags.find((t) => (g.occasions[t] ?? 0) > 0);
    if (top) out.push(`Right vibe for your ${humanize(top)} pattern.`);
  }

  // 6. Stretch framing — only when novelty is high AND the user actually explores
  if (out.length === 0 && parts.novelty.s >= 0.7 && g.explorationRate >= 0.5) {
    out.push("A stretch from your usual pattern, but still within your flavor profile.");
  }

  // 7. Last-resort — never empty, never vague
  if (out.length === 0) {
    if (g.totalVisits === 0) {
      out.push("A solid baseline pick — log a few visits and we'll get more specific.");
    } else if (parts.quality.matched) {
      out.push("Consistently strong reviews — quality safeguard.");
    } else {
      out.push("Within the kind of place you usually pick.");
    }
  }

  return out.slice(0, 3);
}

// ----------------------------------------------------------------------------
// Right Now explanation — primary + secondary + (optional) confidence cue.
// Combines compatibility reasons with the "why right now" framing.
// ----------------------------------------------------------------------------
export type RightNowExplanation = {
  primary: string;
  secondary: string;
  confidenceNote?: string;
};

export function explainRightNow(opts: {
  compat: Compatibility;
  distanceKm: number | null;
  isOpen?: boolean | null;
  isStretch?: boolean;
}): RightNowExplanation {
  const primary = opts.compat.reasons[0]
    ?? (opts.isStretch
      ? "A stretch from your usual pattern, but still within your flavor profile."
      : "Close and highly compatible right now.");

  const parts: string[] = [];
  if (opts.distanceKm != null) parts.push(formatDistanceShort(opts.distanceKm));
  if (opts.isOpen === true) parts.push("open now");
  parts.push(`${opts.compat.score}% match`);

  const out: RightNowExplanation = { primary, secondary: parts.join(" · ") };
  if (opts.compat.confidence === "low") {
    out.confidenceNote = "Early read — Palate's still learning your taste.";
  }
  return out;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatDistanceShort(km: number): string {
  const miles = km * 0.621371;
  if (miles < 0.2) return "right here";
  if (miles < 1) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}
