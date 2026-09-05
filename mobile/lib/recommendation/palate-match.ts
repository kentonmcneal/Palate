// ============================================================================
// recommendation/palate-match.ts — "you and Marcus are a 78% palate match".
// ----------------------------------------------------------------------------
// We already had user-to-user compatibility (lib/palate/pairCompatibility.ts),
// but it returns a qualitative verdict — a type, an axis distance, a summary
// sentence. That is the honest shape of the data and completely unshareable.
//
// Spotify Blend works because there is ONE number. The number is the object
// people screenshot and send; the breakdown is what makes them believe it.
// So this module produces both, and deliberately does not replace the
// qualitative model — it sits alongside it.
//
// Pure function over two taste vectors. No network, no Supabase, no React, so
// the thing our growth loop depends on is testable with fixtures.
//
// PRIVACY: this runs on already-authorized data. The caller is responsible for
// obtaining the other user's vector through friend_taste_features, which
// enforces the friendship check server-side. Nothing here widens access.
// ============================================================================

import type { TasteVector } from "../taste-vector";

/** Both users need real history before a number means anything. Matches the
 *  existing PAIR_READY_MIN_VISITS so the two surfaces agree. */
export const MATCH_MIN_VISITS = 5;

export type MatchReason = {
  kind: "shared_cuisine" | "shared_places" | "divergence" | "shared_price" | "shared_format";
  /** Display string, already humanized. */
  label: string;
};

export type PalateMatch =
  | {
      ready: false;
      /** How many more visits the pair needs, and who owes them. */
      yourVisits: number;
      theirVisits: number;
      threshold: number;
    }
  | {
      ready: true;
      /** 0..100 — the headline. */
      score: number;
      reasons: MatchReason[];
      /** Cuisines both users log a meaningful share of, strongest first. */
      sharedCuisines: string[];
      /** The axis where the two of you differ most. */
      divergence: string | null;
    };

type WeightMap = Record<string, number>;

/** Cosine similarity over two sparse weight maps. 0 when either is empty. */
export function cosine(a: WeightMap, b: WeightMap): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const k of keys) {
    const x = a[k] ?? 0;
    const y = b[k] ?? 0;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function label(slug: string): string {
  return slug
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** Cuisines where both users spend a real share of their eating. */
function sharedTop(a: WeightMap, b: WeightMap, minShare = 0.1, limit = 3): string[] {
  return Object.keys(a)
    .filter((k) => (a[k] ?? 0) >= minShare && (b[k] ?? 0) >= minShare)
    .sort((x, y) => Math.min(b[y], a[y]) - Math.min(b[x], a[x]))
    .slice(0, limit);
}

/** The single axis where the two of you are furthest apart — the interesting
 *  half of a compatibility score, and the part a bare number hides. */
function widestGap(a: WeightMap, b: WeightMap, minGap = 0.25): string | null {
  let worst: { key: string; gap: number } | null = null;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const gap = Math.abs((a[k] ?? 0) - (b[k] ?? 0));
    if (gap >= minGap && (!worst || gap > worst.gap)) worst = { key: k, gap };
  }
  return worst?.key ?? null;
}

// Weights. Cuisine dominates because it is what people mean by "we eat the
// same" — format and price are how you eat, which matters less to the feeling
// of a match but still separates a dive-bar regular from a tasting-menu one.
const W = {
  cuisine: 0.45,
  subregion: 0.15,
  format: 0.15,
  price: 0.10,
  places: 0.15,
};

/**
 * Score two palates against each other.
 *
 * `sharedPlaceCount` / `unionPlaceCount` come from the caller (visited place
 * ids on both sides). Jaccard overlap on actual restaurants is the strongest
 * signal available — two people who have been to six of the same places are
 * compatible in a way no cuisine histogram proves — but it is also the
 * sparsest, so it carries only 15%.
 */
export function computePalateMatch(
  mine: TasteVector | null,
  theirs: TasteVector | null,
  opts: { sharedPlaceCount?: number; unionPlaceCount?: number } = {},
): PalateMatch {
  const yourVisits = mine?.visitCount ?? 0;
  const theirVisits = theirs?.visitCount ?? 0;

  if (!mine || !theirs || yourVisits < MATCH_MIN_VISITS || theirVisits < MATCH_MIN_VISITS) {
    return { ready: false, yourVisits, theirVisits, threshold: MATCH_MIN_VISITS };
  }

  const cuisine = cosine(mine.cuisineRegion, theirs.cuisineRegion);
  const subregion = cosine(mine.cuisineSubregion, theirs.cuisineSubregion);
  const format = cosine(mine.formatClass, theirs.formatClass);
  const price = cosine(mine.priceTier, theirs.priceTier);

  const shared = opts.sharedPlaceCount ?? 0;
  const union = opts.unionPlaceCount ?? 0;
  const places = union > 0 ? shared / union : 0;

  const composite =
    cuisine * W.cuisine +
    subregion * W.subregion +
    format * W.format +
    price * W.price +
    places * W.places;

  // Same shaping as the restaurant match score: a linear map makes even a
  // strong pair read as lukewarm. Floor 20, cap 99 — never claim identical.
  const score = Math.min(99, Math.max(20, Math.round(Math.pow(composite, 0.7) * 100)));

  const sharedCuisines = sharedTop(mine.cuisineRegion, theirs.cuisineRegion);
  const divergence = widestGap(mine.cuisineRegion, theirs.cuisineRegion);

  const reasons: MatchReason[] = [];
  if (sharedCuisines.length > 0) {
    reasons.push({
      kind: "shared_cuisine",
      label: `You both eat ${sharedCuisines.map(label).join(", ")}`,
    });
  }
  if (shared > 0) {
    reasons.push({
      kind: "shared_places",
      label: `You've both been to ${shared} of the same place${shared === 1 ? "" : "s"}`,
    });
  }
  if (price >= 0.8) {
    reasons.push({ kind: "shared_price", label: "You spend about the same" });
  }
  if (format >= 0.8) {
    reasons.push({ kind: "shared_format", label: "You eat out the same way" });
  }
  if (divergence) {
    reasons.push({
      kind: "divergence",
      label: `${label(divergence)} is where you split`,
    });
  }

  return { ready: true, score, reasons, sharedCuisines, divergence };
}

/** One-line headline for the share card and the friend row. */
export function matchHeadline(match: PalateMatch, theirName: string): string {
  if (!match.ready) {
    // Say WHOSE history is short. "4 more visits to unlock" read as a demand on
    // the reader, who in the reported case had 33 visits while the person they
    // were looking at had one.
    const youOwe = Math.max(0, match.threshold - match.yourVisits);
    const theyOwe = Math.max(0, match.threshold - match.theirVisits);
    const plural = (n: number) => `${n} more visit${n === 1 ? "" : "s"}`;

    if (youOwe > 0 && theyOwe > 0) {
      return `You both need a few more visits before this means anything`;
    }
    if (theyOwe > 0) {
      return `${theirName} needs ${plural(theyOwe)} before this means anything`;
    }
    if (youOwe > 0) {
      return `You need ${plural(youOwe)} before this means anything`;
    }
    return "Not enough shared history yet";
  }
  if (match.score >= 85) return `You and ${theirName} eat the same`;
  if (match.score >= 65) return `You and ${theirName} overlap a lot`;
  if (match.score >= 45) return `Some common ground with ${theirName}`;
  return `${theirName} eats nothing like you`;
}
