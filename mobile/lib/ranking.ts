// ============================================================================
// ranking.ts — a ranked list of places, built one question at a time.
// ----------------------------------------------------------------------------
// Beli's ranked list is the best food-identity artifact anyone ships, and its
// weakness is that ranking is manual labour forever: every new place has to be
// binary-searched into position by hand. Passive capture means we already know
// where someone ate, so the only thing we need from them is preference.
//
// WHY ELO AND NOT INSERTION SORT. Binary insertion gives an exact order but
// costs log(n) questions in a row for each new place — a queue, right after a
// meal. The product constraint is ONE question, ever, never a queue. Elo fits
// that exactly: each comparison nudges two ratings, the order emerges over
// time, and a person who answers one question a week still converges.
//
// The cost is that the order is approximate early on. That is the right trade:
// a slightly-wrong list someone actually built beats a perfect list they
// abandoned on question four.
//
// Pure and total. No network, no React, no Date.now() — everything here is a
// function of its arguments, so the tests are the specification.
// ============================================================================

/** Every place starts here. The absolute value is arbitrary; only gaps matter. */
export const DEFAULT_RATING = 1500;

/**
 * How far one comparison can move a rating. High while we know nothing about a
 * place, low once it has a track record — otherwise a single upset late on
 * would throw out everything the earlier answers established.
 */
export function kFactor(comparisons: number): number {
  if (comparisons < 3) return 64;
  if (comparisons < 10) return 32;
  return 16;
}

/** Probability that A beats B, on the standard logistic curve. */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export type Rated = {
  restaurantId: string;
  rating: number;
  comparisons: number;
};

/**
 * Apply one result. Returns BOTH updated records — a comparison is always
 * symmetric, and updating only the winner would inflate the pool over time.
 */
export function applyComparison(
  winner: Rated,
  loser: Rated,
): { winner: Rated; loser: Rated } {
  const expectedWin = expectedScore(winner.rating, loser.rating);
  const kW = kFactor(winner.comparisons);
  const kL = kFactor(loser.comparisons);

  return {
    winner: {
      ...winner,
      rating: winner.rating + kW * (1 - expectedWin),
      comparisons: winner.comparisons + 1,
    },
    loser: {
      ...loser,
      rating: loser.rating - kL * (1 - expectedWin),
      comparisons: loser.comparisons + 1,
    },
  };
}

/**
 * Choose who to compare against.
 *
 * The most informative question is the one we can least predict, i.e. the
 * closest-rated opponent — asking whether your favourite beats your least
 * favourite teaches nothing. Ties break toward the place with the FEWEST
 * comparisons, so a new entry gets placed rather than the same two rivals being
 * asked about forever.
 *
 * Returns null when there is nobody to compare against, which is the honest
 * answer for a user's first rated place.
 */
export function pickOpponent(subject: Rated, pool: Rated[]): Rated | null {
  const others = pool.filter((p) => p.restaurantId !== subject.restaurantId);
  if (others.length === 0) return null;

  let best: Rated | null = null;
  let bestGap = Infinity;
  for (const candidate of others) {
    const gap = Math.abs(candidate.rating - subject.rating);
    if (
      gap < bestGap ||
      (gap === bestGap && best !== null && candidate.comparisons < best.comparisons)
    ) {
      best = candidate;
      bestGap = gap;
    }
  }
  return best;
}

/** Highest rated first. Ties break toward the better-established place, so a
 *  brand-new entry cannot sit above a place that has earned its position. */
export function rankedOrder(pool: Rated[]): Rated[] {
  return [...pool].sort(
    (a, b) => b.rating - a.rating || b.comparisons - a.comparisons,
  );
}

/**
 * How much to trust the list. Ordering means little until places have been
 * compared a few times, and the UI should say so rather than presenting a
 * coin-flip as a ranking.
 */
export function rankingConfidence(pool: Rated[]): "none" | "low" | "medium" | "high" {
  if (pool.length < 2) return "none";
  const total = pool.reduce((sum, p) => sum + p.comparisons, 0);
  // Each comparison informs two places, so this is comparisons-per-place.
  const perPlace = total / pool.length;
  if (perPlace < 1) return "low";
  if (perPlace < 4) return "medium";
  return "high";
}
