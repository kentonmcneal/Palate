// ============================================================================
// palate-labels.ts — short, scannable palate identities.
// ----------------------------------------------------------------------------
// Picks ONE archetype from a TasteVector. Labels are 2-3 words, behavior- or
// vibe-led ("Late-Night Explorer", "Comfort Seeker", "Café Regular"). No
// neighborhoods, no multi-cuisine combos, no fine-grained subregions in the
// title — that detail belongs on the Profile insights screen, not the label.
//
// Each archetype has:
//   - label:     the 2-3 word name
//   - secondary: one short sentence explaining the behavior
//   - match(v):  fit score 0..1 — top scorer wins
//
// Goal: reader understands the identity in under 2 seconds.
// ============================================================================

import {
  type TasteVector,
  type WeightMap,
  topKey,
  topShare,
} from "./taste-vector";

export type PalateIdentity = {
  /** 2-3 word identity, e.g. "Late-Night Explorer". */
  label: string;
  /** One short behavioral sentence, e.g. "You tend to try new spots after dark." */
  secondary: string;
  /** Legacy: bullet-form rationale. Keep populated so older screens don't break. */
  evidence: string[];
  /** Confidence 0..1 — how strong the signal mix is. */
  confidence: number;
  /** Internal: was this composed from signals or generic floor. */
  source: "composed" | "taxonomy";
};

export type PalateIdentitySet = {
  primary: PalateIdentity;
  /** Two secondaries that don't repeat the primary archetype. */
  secondary: [PalateIdentity, PalateIdentity];
  /** This-week mood — same shape, just scored against the weekly vector. */
  weeklyMood: PalateIdentity;
};

// ============================================================================
// Vector helpers
// ============================================================================

function shareOf(map: WeightMap, key: string): number {
  const total = Object.values(map).reduce((s, n) => s + n, 0);
  return total > 0 ? (map[key] ?? 0) / total : 0;
}

function lateNightShare(v: TasteVector): number {
  const total = v.hourly.reduce((s, n) => s + n, 0);
  return total > 0 ? (v.hourly[21] + v.hourly[22] + v.hourly[23] + v.hourly[0]) / total : 0;
}

function morningShare(v: TasteVector): number {
  const total = v.hourly.reduce((s, n) => s + n, 0);
  return total > 0 ? (v.hourly[6] + v.hourly[7] + v.hourly[8] + v.hourly[9]) / total : 0;
}

function lunchShare(v: TasteVector): number {
  const total = v.hourly.reduce((s, n) => s + n, 0);
  return total > 0 ? (v.hourly[11] + v.hourly[12] + v.hourly[13]) / total : 0;
}

function bbqShare(v: TasteVector): number {
  return shareOf(v.cuisineSubregion, "memphis_bbq")
    + shareOf(v.cuisineSubregion, "texas_bbq")
    + shareOf(v.cuisineSubregion, "kc_bbq")
    + shareOf(v.cuisineSubregion, "bbq_general");
}

function pizzaShare(v: TasteVector): number {
  return shareOf(v.cuisineSubregion, "italian_pizzeria")
    + shareOf(v.cuisineSubregion, "italian_neapolitan")
    + shareOf(v.cuisineSubregion, "pizza_nyc")
    + shareOf(v.cuisineSubregion, "pizza_chicago");
}

function ramenShare(v: TasteVector): number {
  return shareOf(v.cuisineSubregion, "japanese_ramen");
}

function sushiShare(v: TasteVector): number {
  return shareOf(v.cuisineSubregion, "japanese_sushi");
}

function tacoShare(v: TasteVector): number {
  return shareOf(v.cuisineSubregion, "mexican_taqueria")
    + shareOf(v.cuisineSubregion, "mexican_regional")
    + shareOf(v.cuisineSubregion, "mexican");
}

function burgerShare(v: TasteVector): number {
  return shareOf(v.cuisineSubregion, "burger");
}

// ============================================================================
// Archetype rules — order matters (more specific first). The top-scoring rule
// whose score clears 0.35 wins. Falls through to the floor if nothing fires.
// ============================================================================

type Rule = {
  label: string;
  secondary: string;
  match: (v: TasteVector) => number;
};

const RULES: Rule[] = [
  // ---------- Time-of-day driven (very legible) ----------
  {
    label: "Late-Night Explorer",
    secondary: "You try new spots after the sun goes down.",
    match: (v) => Math.min(1, lateNightShare(v) * 1.6) * Math.min(1, 0.4 + v.explorationRate * 0.6) * gate(lateNightShare(v) >= 0.25 && v.explorationRate >= 0.45),
  },
  {
    label: "Late-Night Regular",
    secondary: "Your nights have a short list of go-to spots.",
    match: (v) => Math.min(1, lateNightShare(v) * 1.5) * Math.min(1, 0.4 + v.repeatRate * 0.6) * gate(lateNightShare(v) >= 0.3 && v.repeatRate >= 0.4),
  },
  {
    label: "Early Riser",
    secondary: "Your day starts with a meal, not a meeting.",
    match: (v) => Math.min(1, morningShare(v) * 1.6) * gate(morningShare(v) >= 0.3),
  },
  {
    label: "Lunch-Hour Regular",
    secondary: "You've optimized the workday lunch.",
    match: (v) => Math.min(1, lunchShare(v) * 1.5) * gate(lunchShare(v) >= 0.35 && v.weekendShare <= 0.3),
  },

  // ---------- Format / vibe ----------
  {
    label: "Café Regular",
    secondary: "A familiar counter, a familiar order.",
    match: (v) => Math.min(1, shareOf(v.formatClass, "café") * 1.6) * gate(shareOf(v.formatClass, "café") >= 0.35),
  },
  {
    label: "Wine Bar Regular",
    secondary: "You eat for the pour as much as the plate.",
    match: (v) => Math.min(1, shareOf(v.formatClass, "wine_bar") * 2) * gate(shareOf(v.formatClass, "wine_bar") >= 0.25),
  },
  {
    label: "Steakhouse Patron",
    secondary: "When you go big, you go classic.",
    match: (v) => Math.min(1, shareOf(v.cuisineSubregion, "steakhouse") * 2) * gate(shareOf(v.cuisineSubregion, "steakhouse") >= 0.2 && v.averagePriceLevel >= 2.5),
  },
  {
    label: "Quick-Bite Pragmatist",
    secondary: "Speed matters; you've found what works.",
    match: (v) => Math.min(1, shareOf(v.formatClass, "quick_service") * 1.5) * gate(shareOf(v.formatClass, "quick_service") >= 0.45 && v.repeatRate >= 0.4),
  },
  {
    label: "Fine-Dining Curator",
    secondary: "You go less often and pick more carefully.",
    match: (v) => 0.7 * gate(shareOf(v.formatClass, "fine_dining") >= 0.25),
  },

  // ---------- Cuisine-led shorts ----------
  {
    label: "BBQ Loyalist",
    secondary: "Smoke, sauce, and a short list of trusted pits.",
    match: (v) => Math.min(1, bbqShare(v) * 1.8) * gate(bbqShare(v) >= 0.3),
  },
  {
    label: "Pizza Loyalist",
    secondary: "You've earned an opinion on every slice in town.",
    match: (v) => Math.min(1, pizzaShare(v) * 1.6) * gate(pizzaShare(v) >= 0.3),
  },
  {
    label: "Sushi Devotee",
    secondary: "You read the omakase before the menu.",
    match: (v) => Math.min(1, sushiShare(v) * 2) * gate(sushiShare(v) >= 0.2),
  },
  {
    label: "Ramen Night Owl",
    secondary: "Late nights end in a steaming bowl.",
    match: (v) => Math.min(1, ramenShare(v) * 2 + lateNightShare(v) * 0.5) * gate(ramenShare(v) >= 0.2 && lateNightShare(v) >= 0.2),
  },
  {
    label: "Taco Cartographer",
    secondary: "Mapping the city, one tortilla at a time.",
    match: (v) => Math.min(1, tacoShare(v) * 1.8) * gate(tacoShare(v) >= 0.25),
  },
  {
    label: "Burger Regular",
    secondary: "You know whose grind hits hardest.",
    match: (v) => Math.min(1, burgerShare(v) * 2) * gate(burgerShare(v) >= 0.3),
  },

  // ---------- Occasion-led ----------
  {
    label: "Brunch Devotee",
    secondary: "Weekend mornings are a ritual.",
    match: (v) => Math.min(1, shareOf(v.occasion, "brunch") * 2) * gate(shareOf(v.occasion, "brunch") >= 0.3),
  },
  {
    label: "Date-Night Curator",
    secondary: "Each pick is staged for the company.",
    match: (v) => Math.min(1, shareOf(v.occasion, "date_night") * 2) * gate(shareOf(v.occasion, "date_night") >= 0.3),
  },
  {
    label: "Social Diner",
    secondary: "The table matters as much as the meal.",
    match: (v) => {
      const social = shareOf(v.occasion, "group_dinner") + shareOf(v.occasion, "date_night");
      return Math.min(1, social * 1.5) * gate(social >= 0.4);
    },
  },
  {
    label: "Solo Diner",
    secondary: "You eat at the counter and read the room.",
    match: (v) => Math.min(1, shareOf(v.occasion, "casual_solo") * 1.8) * gate(shareOf(v.occasion, "casual_solo") >= 0.4),
  },

  // ---------- Behavior-led ----------
  {
    label: "Comfort Seeker",
    secondary: "Familiar wins over novel, most weeks.",
    match: (v) => Math.min(1, v.repeatRate * 1.4) * gate(v.repeatRate >= 0.55 && v.explorationRate <= 0.5),
  },
  {
    label: "Loyal Local",
    secondary: "A few blocks, a few favorites — that's enough.",
    match: (v) => Math.min(1, v.neighborhoodLoyalty * 1.4) * gate(v.neighborhoodLoyalty >= 0.55 && v.repeatRate >= 0.4),
  },
  {
    label: "Variety Seeker",
    secondary: "You'd rather try something new than repeat a hit.",
    match: (v) => Math.min(1, v.explorationRate * 1.2) * gate(v.explorationRate >= 0.65 && v.uniqueRestaurants >= 6),
  },
  {
    label: "Weekend Adventurer",
    secondary: "The week is for routine, the weekend is for elsewhere.",
    match: (v) => Math.min(1, v.weekendShare * 1.4) * Math.min(1, 0.4 + v.explorationRate * 0.6) * gate(v.weekendShare >= 0.55 && v.explorationRate >= 0.4),
  },
  {
    label: "Weeknight Regular",
    secondary: "Tuesday dinner has a name and a table.",
    match: (v) => Math.min(1, (1 - v.weekendShare) * 1.2) * Math.min(1, v.repeatRate * 1.4) * gate(v.weekendShare <= 0.3 && v.repeatRate >= 0.4),
  },
  {
    label: "Hidden-Gem Hunter",
    secondary: "You'd rather find the place than be told about it.",
    match: (v) => 0.65 * gate((v.culturalContext["hidden"] ?? 0) >= 3),
  },
  {
    label: "Trend Tastemaker",
    secondary: "You catch the new spot before the line forms.",
    match: (v) => 0.65 * gate((v.culturalContext["trending"] ?? 0) >= 3),
  },
  {
    label: "High-Low Tastemaker",
    secondary: "Counter-service and tasting menus, same week.",
    match: (v) => 0.6 * gate(v.priceSpread >= 0.66),
  },
  {
    label: "Cuisine Cartographer",
    secondary: "You're working through the world's menu in order.",
    match: (v) => 0.6 * gate(Object.keys(v.cuisineRegion).length >= 6),
  },

  // ---------- Floors ----------
  {
    label: "Pattern Forming",
    secondary: "A picture is starting to emerge.",
    match: (v) => 0.3 * gate(v.visitCount > 0),
  },
  {
    label: "Just Getting Started",
    secondary: "Log a few visits and we'll start drawing the picture.",
    match: () => 0.1,
  },
];

function gate(cond: boolean): number {
  return cond ? 1 : 0;
}

// ============================================================================
// Public API
// ============================================================================

export function generateIdentitySet(allTime: TasteVector, weekly?: TasteVector): PalateIdentitySet {
  const ranked = scoreAll(allTime);
  const primary = ranked[0] ?? floor(allTime);
  const secondary = pickDistinct(ranked.slice(1), primary);
  const weeklyMood = weekly ? (scoreAll(weekly)[0] ?? floor(weekly)) : floor(allTime);
  return { primary, secondary: [secondary[0], secondary[1]], weeklyMood };
}

function scoreAll(v: TasteVector): PalateIdentity[] {
  return RULES
    .map((r) => ({ rule: r, score: r.match(v) }))
    .filter((x) => x.score > 0.35)
    .sort((a, b) => b.score - a.score)
    .map(({ rule, score }) => ({
      label: rule.label,
      secondary: rule.secondary,
      evidence: [rule.secondary],
      confidence: Math.min(1, score),
      source: "composed" as const,
    }));
}

function pickDistinct(rest: PalateIdentity[], primary: PalateIdentity): [PalateIdentity, PalateIdentity] {
  const primaryWord = lastWord(primary.label);
  const distinct = rest.filter((r) => lastWord(r.label) !== primaryWord);
  const a = distinct[0] ?? rest[0] ?? floor();
  const b = distinct.find((r) => r.label !== a.label) ?? rest.find((r) => r.label !== a.label) ?? floor({}, true);
  return [a, b];
}

function floor(_v?: TasteVector | {}, mood?: boolean): PalateIdentity {
  const label = mood ? "Pattern Forming" : "Just Getting Started";
  const secondary = mood
    ? "A picture is starting to emerge."
    : "Log a few visits and we'll start drawing the picture.";
  return { label, secondary, evidence: [secondary], confidence: 0.2, source: "taxonomy" };
}

function lastWord(label: string): string {
  const parts = label.trim().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

/** Exposed for diagnostics. */
export const FALLBACK_LABEL_COUNT = RULES.length;

// ============================================================================
// Lore — one-sentence "voice over" line. Used by Wrapped as the single insight.
// Kept short and concrete, no jargon.
// ============================================================================

export function generateLore(v: TasteVector, primary: PalateIdentity): string {
  if (v.visitCount === 0) return "Log your first visit to start your story.";
  // Prefer the archetype's own secondary — it's already one tight sentence.
  if (primary.secondary && primary.source === "composed") return primary.secondary;

  // Floor / generic — derive a quick pattern note.
  const top = topKey(v.cuisineSubregion) ?? topKey(v.cuisineRegion);
  if (top) return `${humanize(top)} keeps showing up in your week.`;
  return "Your week tells a story your menu wouldn't.";
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

// ============================================================================
// Expanded lore — used on the deep Insights screen (Profile). Keyed off the
// archetype's last word so it survives label edits.
// ============================================================================

export type PalateLore = { story: string; behavior: string };

export function expandedLore(primary: PalateIdentity): PalateLore {
  return ARCHETYPE_LORE[lastWord(primary.label)] ?? ARCHETYPE_LORE.Default;
}

const ARCHETYPE_LORE: Record<string, PalateLore> = {
  Explorer: {
    story: "Curiosity-driven. Tries and misses over safe and same.",
    behavior: "Reads menus end-to-end. Takes the off-list pick.",
  },
  Regular: {
    story: "Settled, not stuck. A few spots carry the week.",
    behavior: "Steady cadence. Gets the 'the usual?' nod.",
  },
  Loyalist: {
    story: "Trusts the homework. Favorites become rituals.",
    behavior: "Same spots, same dishes. Verified-good over variety.",
  },
  Devotee: {
    story: "One thing, deep. Focused, not narrow.",
    behavior: "Knows the sub-styles. Has opinions.",
  },
  Curator: {
    story: "Few visits, none wasted.",
    behavior: "Skips the obvious. Goes once, knows.",
  },
  Patron: {
    story: "Same upmarket spots, on rotation.",
    behavior: "Loyalty plus spending power, channeled.",
  },
  Pragmatist: {
    story: "Optimizes for the day, not the meal.",
    behavior: "Fast in, fast out, never disappointed.",
  },
  Diner: {
    story: "The room and the company shape the meal.",
    behavior: "Picks for the table, remembers the night.",
  },
  Seeker: {
    story: "Familiar isn't the goal — the search is.",
    behavior: "First impressions, then on to the next.",
  },
  Devourer: {
    story: "Eats with intent. Not afraid to be early.",
    behavior: "Tracks openings. Goes the first month.",
  },
  Cartographer: {
    story: "Building a map, not a list.",
    behavior: "Wide spread, rare repeats.",
  },
  Local: {
    story: "Your block runs your week.",
    behavior: "Knows the staff, the timing, the off-menu.",
  },
  Adventurer: {
    story: "The weekend pulls you out of routine.",
    behavior: "Saturday plans = somewhere you haven't been.",
  },
  Hunter: {
    story: "You'd rather find it than be told about it.",
    behavior: "Bookmarks the back-of-the-room spots.",
  },
  Tastemaker: {
    story: "Moves between casual and upscale fluently.",
    behavior: "$9 taco and $200 tasting in the same week.",
  },
  "Owl": {
    story: "Eating life starts after most kitchens close.",
    behavior: "Seats open up; you're already there.",
  },
  Riser: {
    story: "Mornings aren't a chore — they're the plan.",
    behavior: "Counter at 7, paper, eggs.",
  },
  Default: {
    story: "Your pattern is forming.",
    behavior: "Keep logging. The picture gets specific by week three.",
  },
};
