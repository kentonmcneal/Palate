import visitsFixture from "../__fixtures__/founder-visit-places.json";
import { founderGraph, poolAsInputs } from "./ranking-harness.test";
import { scoreRestaurant } from "../scoring";
import type { TasteGraph } from "../taste-graph";
import type { RestaurantInput } from "../types";
import {
  randomRanker, popularityRanker, rankOf, summarize, pairedVs, formatTable,
  expectedRandomMrr, type EvalRow,
} from "../eval";

// ============================================================================
// The eval: is the ranker better than doing nothing?
// ----------------------------------------------------------------------------
// held-out.test.ts has recorded MRR since 2026-09-06 and could not interpret
// it, because there was nothing beside it. 0.054 is meaningless alone; against
// a random floor and a free popularity sort it becomes an answer.
//
// Same leave-one-out protocol as held-out.test.ts, deliberately: the graph is
// rebuilt with the target place's cuisine/region/format contribution removed,
// so the scorer is ranking a place it has never seen. Anything else measures
// memorisation.
//
// FOUR held-out places. That is the honest sample and it is small, so the gate
// here is PAIRED — did this ranker beat that one on the same four items —
// rather than an absolute threshold, which four points cannot support.
// ============================================================================

type Row = { google_place_id: string; visited_at: string; cuisine_type: string | null };
const HERE = { lat: 35.098, lng: -89.841 };
const NOW = new Date(2026, 8, 8, 19, 30);

/** Remove the target's contribution, exactly as held-out.test.ts does. */
function without(
  g: TasteGraph,
  cuisine: string | null, region: string | null,
  sub: string | null, format: string | null, n: number,
): TasteGraph {
  const drop = (m: Record<string, number>, k: string | null) => {
    if (!k) return m;
    const out = { ...m };
    out[k] = Math.max(0, (out[k] ?? 0) - n);
    if (out[k] === 0) delete out[k];
    return out;
  };
  return {
    ...g,
    cuisineTypes: drop(g.cuisineTypes, cuisine),
    cuisines: drop(g.cuisines, region),
    cuisinesSubregion: drop(g.cuisinesSubregion, sub),
    formats: drop(g.formats, format),
    totalVisits: Math.max(0, g.totalVisits - n),
    restaurantVisits: {},
  };
}

describe("eval — the ranker against baselines", () => {
  const pool = poolAsInputs();
  const byId = new Map(pool.map((r) => [r.google_place_id, r]));

  const counts = new Map<string, number>();
  for (const v of visitsFixture as Row[]) {
    counts.set(v.google_place_id, (counts.get(v.google_place_id) ?? 0) + 1);
  }
  const held = [...counts.entries()].filter(([id]) => byId.has(id));

  /** The shipped scorer, ranking from a graph that never saw the target. */
  function personalizedRanks(): number[] {
    return held.map(([id, n]) => {
      const r = byId.get(id)! as RestaurantInput & {
        cuisine_region?: string | null; cuisine_subregion?: string | null; format_class?: string | null;
      };
      const g = without(
        founderGraph(), r.cuisine_type ?? null, r.cuisine_region ?? null,
        r.cuisine_subregion ?? null, r.format_class ?? null, n,
      );
      const order = pool
        .map((p) => ({ id: p.google_place_id, s: scoreRestaurant(g, p, { here: HERE, now: NOW, mode: "browsing" }).finalScore }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.id);
      return rankOf(order, id);
    });
  }

  /** Baselines see the same targets and the same pool. */
  function baselineRanks(ranker: { rank: (p: RestaurantInput[], id: string) => string[] }): number[] {
    return held.map(([id]) => rankOf(ranker.rank(pool, id), id));
  }

  let rows: EvalRow[];
  let personalized: EvalRow, popularity: EvalRow, random: EvalRow;

  beforeAll(() => {
    personalized = summarize("personalized", personalizedRanks());
    popularity   = summarize("popularity",   baselineRanks(popularityRanker()));
    random       = summarize("random",       baselineRanks(randomRanker(42)));
    rows = [personalized, popularity, random];
  });

  it("reports the comparison", () => {
    const vsRandom = pairedVs(personalized, random);
    const vsPop = pairedVs(personalized, popularity);
    // eslint-disable-next-line no-console
    console.log(
      "\n" + formatTable(rows, pool.length) +
      `\n\n  personalized vs random     W/L/T ${vsRandom.wins}/${vsRandom.losses}/${vsRandom.ties}` +
      `\n  personalized vs popularity W/L/T ${vsPop.wins}/${vsPop.losses}/${vsPop.ties}` +
      `\n  ranks: personalized [${personalized.ranks.join(", ")}]` +
      `\n         popularity   [${popularity.ranks.join(", ")}]` +
      `\n         random       [${random.ranks.join(", ")}]\n`,
    );
    expect(rows.every((r) => r.n === held.length)).toBe(true);
  });

  it("the random baseline behaves like chance, so the floor is trustworthy", () => {
    // Guards the harness itself: a 'random' baseline that is secretly ordered
    // would flatter everything measured against it.
    expect(random.mrr).toBeLessThan(expectedRandomMrr(pool.length) * 12);
    expect(random.meanRank).toBeGreaterThan(pool.length * 0.15);
  });

  it("beats random — the minimum claim personalisation has to make", () => {
    const { wins, losses } = pairedVs(personalized, random);
    expect(personalized.mrr).toBeGreaterThan(random.mrr);
    expect(wins).toBeGreaterThanOrEqual(losses);
  });

  it("records where it stands against a free popularity sort", () => {
    // NOT asserted as a pass/fail gate yet: four points cannot carry it, and
    // a red test nobody can act on gets deleted. Recorded so the direction is
    // visible, and so the day the sample is big enough this becomes the gate
    // that matters — if personalisation cannot beat sorting by rating, it is
    // costing more than it earns.
    const { wins, losses, ties } = pairedVs(personalized, popularity);
    // eslint-disable-next-line no-console
    console.log(`  [record] vs popularity: ${wins}W ${losses}L ${ties}T · MRR ${personalized.mrr.toFixed(3)} vs ${popularity.mrr.toFixed(3)}`);
    expect(wins + losses + ties).toBe(held.length);
  });
});
