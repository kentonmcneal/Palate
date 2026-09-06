// ============================================================================
// recommendation/reranking.ts — turn a ranking into a shortlist.
// ----------------------------------------------------------------------------
// rerank() used to live here: a seven-rule pass (diversity, freshness,
// stretch interleave, ...) with no production caller. Home used capByKey
// and Discover used nothing. Two reranking implementations that disagree
// is how the next regression gets in, so the one that ran is the one that
// stays.
// ============================================================================


/**
 * The diversity rule on its own, for callers whose items are not
 * RankedRestaurant.
 *
 * Three picks that are all burgers is not a choice, it is the same suggestion
 * three times. Home shipped exactly that: ranked against the founder's real
 * graph, the top ten of the two-hundred-place Memphis pool were ten American
 * restaurants. The cap is what turns a ranking into a shortlist.
 *
 * Order is otherwise preserved: this is a greedy pass that skips an item whose
 * key is already at the cap and comes back for it only if the list would
 * otherwise be short. Nothing is dropped that would leave a gap.
 */
export function capByKey<T>(
  items: T[],
  keyOf: (t: T) => string | null | undefined,
  cap: number,
  limit: number,
): T[] {
  const counts = new Map<string, number>();
  const out: T[] = [];
  const skipped: T[] = [];
  for (const it of items) {
    if (out.length >= limit) break;
    const k = (keyOf(it) ?? "").toLowerCase();
    const n = k ? (counts.get(k) ?? 0) : 0;
    if (k && n >= cap) { skipped.push(it); continue; }
    if (k) counts.set(k, n + 1);
    out.push(it);
  }
  // A thin pool must never come back shorter because of the cap.
  for (const it of skipped) {
    if (out.length >= limit) break;
    out.push(it);
  }
  return out;
}
