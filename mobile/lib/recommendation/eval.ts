// ============================================================================
// eval.ts — metrics and baselines for the ranker.
// ----------------------------------------------------------------------------
// The held-out harness has measured MRR since 2026-09-06 and recorded 0.054.
// Nobody could say whether 0.054 was good, because there was nothing to
// compare it to. A number with no baseline is not a measurement — it is a
// number, and it cannot answer the only question an eval exists to answer:
// is this change better than the last one, and better than doing nothing?
//
// So this module supplies the two missing halves:
//
//   1. BASELINES. Random says what luck alone scores on this pool. Popularity
//      says what you get for free by sorting on Google's rating — the thing a
//      personalisation engine has to beat to justify existing at all.
//   2. PAIRED COMPARISON. There are four held-out places. Four points cannot
//      support an absolute threshold, but they can support "did A beat B on
//      the SAME four", which is a far stronger claim at small n than any
//      floor. Every ranker here is scored over identical items.
//
// Pure. No network, no fixtures, no Supabase. The data comes from the caller
// so the same metrics work on fixtures today and real visits later.
// ============================================================================

import type { RestaurantInput } from "./types";

/** A ranker orders the pool best-first and returns google_place_ids. */
export type Ranker = {
  name: string;
  rank: (pool: RestaurantInput[], heldOutId: string) => string[];
};

/** 1-based position of `id`, or 0 when absent — 0 reads as "never surfaced". */
export function rankOf(order: string[], id: string): number {
  return order.indexOf(id) + 1;
}

/** Mean reciprocal rank. Ranks of 0 (absent) contribute nothing. */
export function mrr(ranks: number[]): number {
  if (!ranks.length) return 0;
  return ranks.reduce((s, r) => s + (r > 0 ? 1 / r : 0), 0) / ranks.length;
}

/** Share of targets that appear in the top k. */
export function recallAt(ranks: number[], k: number): number {
  if (!ranks.length) return 0;
  return ranks.filter((r) => r > 0 && r <= k).length / ranks.length;
}

/** NDCG@k. Exactly one relevant item per query, so IDCG is 1 and this
 *  reduces to the mean of 1/log2(rank+1) for hits inside k. */
export function ndcgAt(ranks: number[], k: number): number {
  if (!ranks.length) return 0;
  return ranks.reduce(
    (s, r) => s + (r > 0 && r <= k ? 1 / Math.log2(r + 1) : 0),
    0,
  ) / ranks.length;
}

export function meanRank(ranks: number[]): number {
  const hit = ranks.filter((r) => r > 0);
  return hit.length ? hit.reduce((s, r) => s + r, 0) / hit.length : 0;
}

/** What MRR pure luck scores on a pool of this size, in closed form:
 *  E[1/rank] over a uniform rank is H(n)/n. Printed beside the measured
 *  random baseline as a check that the shuffle is actually uniform. */
export function expectedRandomMrr(poolSize: number): number {
  let h = 0;
  for (let i = 1; i <= poolSize; i++) h += 1 / i;
  return h / poolSize;
}

/** Deterministic PRNG. A baseline that moves between runs is not a baseline. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Luck. The floor any ranker must clear to be doing anything at all. */
export function randomRanker(seed = 42): Ranker {
  return {
    name: "random",
    rank: (pool) => {
      const rnd = mulberry32(seed);
      return pool
        .map((r) => ({ id: r.google_place_id, k: rnd() }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.id);
    },
  };
}

/** Google's rating, ties broken by how many people rated it. This is the
 *  real bar: it is free, needs no taste graph, and if personalisation cannot
 *  beat it then personalisation is costing more than it earns. */
export function popularityRanker(): Ranker {
  return {
    name: "popularity",
    rank: (pool) =>
      [...pool]
        .sort((a, b) =>
          (b.rating ?? 0) - (a.rating ?? 0) ||
          (b.user_rating_count ?? 0) - (a.user_rating_count ?? 0))
        .map((r) => r.google_place_id),
  };
}

export type EvalRow = {
  name: string;
  n: number;
  mrr: number;
  recall10: number;
  recall30: number;
  ndcg30: number;
  meanRank: number;
  ranks: number[];
};

export function summarize(name: string, ranks: number[]): EvalRow {
  return {
    name,
    n: ranks.length,
    mrr: mrr(ranks),
    recall10: recallAt(ranks, 10),
    recall30: recallAt(ranks, 30),
    ndcg30: ndcgAt(ranks, 30),
    meanRank: meanRank(ranks),
    ranks,
  };
}

/** Paired win/loss against a baseline on identical items — the honest
 *  comparison when n is four. Ties are counted, not hidden. */
export function pairedVs(subject: EvalRow, baseline: EvalRow): {
  wins: number; losses: number; ties: number;
} {
  let wins = 0, losses = 0, ties = 0;
  for (let i = 0; i < subject.ranks.length; i++) {
    const a = subject.ranks[i], b = baseline.ranks[i];
    // A missing item is worse than any real rank.
    const av = a > 0 ? a : Number.POSITIVE_INFINITY;
    const bv = b > 0 ? b : Number.POSITIVE_INFINITY;
    if (av < bv) wins++; else if (av > bv) losses++; else ties++;
  }
  return { wins, losses, ties };
}

export function formatTable(rows: EvalRow[], poolSize: number): string {
  const pad = (s: string, n: number) => s.padEnd(n);
  const num = (x: number, d = 3) => x.toFixed(d).padStart(7);
  const head =
    `  ${pad("ranker", 14)}${pad("n", 4)}${"MRR".padStart(7)}` +
    `${"R@10".padStart(8)}${"R@30".padStart(8)}${"NDCG@30".padStart(9)}${"meanRank".padStart(10)}`;
  const body = rows.map((r) =>
    `  ${pad(r.name, 14)}${pad(String(r.n), 4)}${num(r.mrr)}` +
    `${num(r.recall10, 2).padStart(8)}${num(r.recall30, 2).padStart(8)}` +
    `${num(r.ndcg30).padStart(9)}${r.meanRank.toFixed(1).padStart(10)}`,
  );
  return [
    `  pool ${poolSize} · random MRR by theory ${expectedRandomMrr(poolSize).toFixed(4)}`,
    head, ...body,
  ].join("\n");
}
