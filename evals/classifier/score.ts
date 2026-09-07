// ============================================================================
// Scoring the classifier. Pure, so it can be tested without running anything.
// ----------------------------------------------------------------------------
// "Accuracy" is the wrong single number here, because the ways of being wrong
// cost different amounts:
//
//   OVERREACH — guessed a cuisine for a place that has none knowable. The most
//               expensive error there is. A wrong cuisine is written into
//               public.restaurants, feeds the taste graph, and quietly moves
//               somebody's recommendations for as long as the row lives.
//   WRONG     — guessed, and guessed the wrong cuisine. Same cost, but at
//               least the place had an answer to get right.
//   MISSED    — abstained where the answer was there to be had. Cheap: the
//               place simply cannot match anybody's taste, so it under-ranks.
//               A miss helps nobody; it does not mislead anybody either.
//
// So the floors below are asymmetric on purpose. Abstention is close to free.
// Confidence is not.
// ============================================================================

export type Outcome = "correct" | "wrong" | "missed" | "overreach";

export function outcomeOf(expected: string | null, actual: string | null): Outcome {
  if (expected === actual) return "correct";
  if (expected === null) return "overreach";
  if (actual === null) return "missed";
  return "wrong";
}

export type Tally = Record<Outcome, number>;

export function tally(rows: Array<{ expected: string | null; actual: string | null }>): Tally {
  const t: Tally = { correct: 0, wrong: 0, missed: 0, overreach: 0 };
  for (const r of rows) t[outcomeOf(r.expected, r.actual)]++;
  return t;
}

/** Share of cases the classifier got exactly right, abstentions included. */
export function accuracy(t: Tally): number {
  const n = t.correct + t.wrong + t.missed + t.overreach;
  return n === 0 ? 0 : t.correct / n;
}

/**
 * Of the times it committed to an answer, how often was it right. This is the
 * number that matters most: everything it commits to is written to a row and
 * read back as fact.
 */
export function precision(t: Tally): number {
  const committed = t.correct + t.wrong + t.overreach;
  return committed === 0 ? 1 : t.correct / committed;
}

export function format(t: Tally): string {
  return `correct=${t.correct} wrong=${t.wrong} missed=${t.missed} overreach=${t.overreach}`
    + ` | accuracy=${(accuracy(t) * 100).toFixed(0)}% precision=${(precision(t) * 100).toFixed(0)}%`;
}
