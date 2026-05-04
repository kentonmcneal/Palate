// ============================================================================
// right-now.ts — picks ONE recommendation for the Home hero ("What should I
// eat right now?") and ONE for the Stretch slot.
// ----------------------------------------------------------------------------
// Right Now ranking factors (in this order of weight):
//   1. compatibility score (palate-match-score)
//   2. distance penalty (closer is better — dining decisions are "right now")
//   3. time-of-day fit (occasion tags vs. current hour)
//   4. anti-staleness (don't keep recommending the same place)
//   5. novelty mid-band (not a place visited 5x already, but not random either)
//
// Stretch is the inverse: highest novelty inside a sane band, still > 50 fit.
//
// Each pick comes back with a structured explanation: 1-3 short reasons that
// reference the user's actual behavior. The UI renders these verbatim.
// ============================================================================

import { rankRestaurantsForDiscovery, type RankedRestaurant } from "./restaurant-ranking";
import { calculatePalateMatchScore, type RestaurantInput } from "./palate-match-score";
import type { TasteVector } from "./taste-vector";
import type { PersonalSignal } from "./personal-signal";
import { distanceKm, formatDistance } from "./match-score";

export type RightNowExplanation = {
  /** "Because you liked X" / "Matches your recent behavior" / "Close and highly compatible" */
  primary: string;
  /** Optional second line — "5 min walk · open now · 87% match". */
  secondary: string;
};

export type RightNowPick = {
  restaurant: RankedRestaurant;
  explanation: RightNowExplanation;
};

export type StretchPick = {
  restaurant: RankedRestaurant;
  explanation: RightNowExplanation;
};

// ----------------------------------------------------------------------------
// Public entry points
// ----------------------------------------------------------------------------

export async function pickRightNowAndStretch(opts: {
  vector: TasteVector | null;
  candidates: RestaurantInput[];
  here?: { lat: number; lng: number } | null;
  personal?: PersonalSignal | null;
  now?: Date;
}): Promise<{ rightNow: RightNowPick | null; stretch: StretchPick | null }> {
  if (opts.candidates.length === 0) return { rightNow: null, stretch: null };

  const now = opts.now ?? new Date();

  // Use the existing bucketed ranker so Right Now and Stretch stay aligned
  // with the same logic Discovery uses. Larger perBucket so there's more
  // headroom to apply our extra distance + staleness re-rank.
  const buckets = await rankRestaurantsForDiscovery({
    vector: opts.vector,
    candidates: opts.candidates,
    here: opts.here ?? undefined,
    now,
    perBucket: 12,
  });

  // ---- RIGHT NOW ----
  // Re-score the safe pool with personal signal + anti-staleness + a
  // distance-weighted composite. We want THE one decision, not a list.
  const rightNowCandidates = (buckets.safe.length > 0 ? buckets.safe : buckets.trending)
    .map((r) => {
      const m = calculatePalateMatchScore(opts.vector, r, {
        here: opts.here ?? undefined,
        now,
        personal: opts.personal ?? undefined,
        applyStaleness: true,
        intent: "neutral",
      });
      const distance = distanceOf(r, opts.here);
      const proximityBoost = distance != null ? Math.max(0, 6 - distance) : 0; // up to +6 within 6km
      const composite = m.score + proximityBoost;
      return { r: { ...r, match: m }, composite, distance };
    })
    .sort((a, b) => b.composite - a.composite);

  const rightNow = rightNowCandidates[0]
    ? {
        restaurant: rightNowCandidates[0].r,
        explanation: buildExplanation(
          rightNowCandidates[0].r,
          rightNowCandidates[0].distance,
          opts.vector,
          opts.personal,
          "right_now",
        ),
      }
    : null;

  // ---- STRETCH ----
  // The bucketed ranker already scored stretch with stretch intent. Re-apply
  // personal signal so dismissed/loved items still count, and pick the top.
  const stretchCandidates = buckets.stretch
    .filter((r) => r.google_place_id !== rightNow?.restaurant.google_place_id)
    .map((r) => {
      const m = calculatePalateMatchScore(opts.vector, r, {
        here: opts.here ?? undefined,
        now,
        personal: opts.personal ?? undefined,
        applyStaleness: true,
        intent: "stretch",
      });
      const distance = distanceOf(r, opts.here);
      return { r: { ...r, match: m }, distance };
    })
    .sort((a, b) => b.r.match.score - a.r.match.score);

  const stretch = stretchCandidates[0]
    ? {
        restaurant: stretchCandidates[0].r,
        explanation: buildExplanation(
          stretchCandidates[0].r,
          stretchCandidates[0].distance,
          opts.vector,
          opts.personal,
          "stretch",
        ),
      }
    : null;

  return { rightNow, stretch };
}

// ----------------------------------------------------------------------------
// Explanation builder — produces a primary "why" line that references the
// user's actual behavior, plus a secondary status line ("5 min walk · 87% match").
// ----------------------------------------------------------------------------

function buildExplanation(
  r: RankedRestaurant,
  distance: number | null,
  vector: TasteVector | null,
  personal: PersonalSignal | null | undefined,
  mode: "right_now" | "stretch",
): RightNowExplanation {
  const reasons: string[] = [];

  // A. Personal-signal-driven reasons land first — they're the most specific.
  if (personal) {
    if (r.cuisine_type) {
      const c = personal.itemSentimentByCuisine.get(r.cuisine_type);
      if (c && c.loved >= 2) {
        reasons.push(`You've loved ${c.loved} ${humanize(r.cuisine_type)} dishes.`);
      }
    }
    const friends = personal.friendVisitsByPlaceId.get(r.google_place_id) ?? 0;
    if (friends > 0) {
      reasons.push(`${friends} friend${friends === 1 ? "" : "s"} ${friends === 1 ? "has" : "have"} visited.`);
    }
  }

  // B. Vector-driven reasons — fall back when personal signal is sparse.
  if (reasons.length === 0 && vector && r.cuisine_subregion) {
    const share = shareOf(vector.cuisineSubregion, r.cuisine_subregion);
    if (share >= 0.15) {
      reasons.push(`Matches your ${humanize(r.cuisine_subregion)} pattern.`);
    }
  }
  if (reasons.length === 0 && r.match.reasons[0]) {
    reasons.push(r.match.reasons[0]);
  }

  // C. Mode-specific framing if we still have nothing concrete.
  if (reasons.length === 0) {
    reasons.push(mode === "stretch"
      ? "A stretch from your usual pattern — worth a try."
      : "Close and highly compatible right now.");
  }

  const primary = reasons[0];

  // Secondary: a tight status line ("0.4 mi · 87% match")
  const parts: string[] = [];
  if (distance != null) parts.push(formatDistance(distance));
  parts.push(`${r.match.score}% match`);
  const secondary = parts.join(" · ");

  return { primary, secondary };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function distanceOf(r: RankedRestaurant, here: { lat: number; lng: number } | null | undefined): number | null {
  if (!here || r.latitude == null || r.longitude == null) return null;
  return distanceKm(here, { lat: r.latitude, lng: r.longitude });
}

function shareOf(map: Record<string, number>, key: string): number {
  const total = Object.values(map).reduce((s, n) => s + n, 0);
  return total > 0 ? (map[key] ?? 0) / total : 0;
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
