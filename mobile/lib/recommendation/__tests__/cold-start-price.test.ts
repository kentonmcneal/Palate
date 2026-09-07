import { poolAsInputs } from "./ranking-harness.test";
import { scoreRestaurant } from "../scoring";
import { assembleGraph } from "../taste-graph";
import { filterRecommendable } from "../eligibility";
import { dedupeVenues } from "../dedupe";

// ============================================================================
// What a stranger sees. Characterization, not approval.
// ----------------------------------------------------------------------------
// Fifty TestFlight testers will open this app with no visits, no saves and no
// ratings, and every dimension that personalises the ranking is flat for them:
// taste is shrunk to neutral by the cold-start trust factor, social is zero,
// novelty returns a constant when there is no cuisine history. The only term
// left that varies is quality — which compatibility.ts documents as "a
// SAFEGUARD, not a primary signal (per spec)".
//
// At cold start it is the primary signal, and Google rating tracks price, so
// the ranking becomes a price ladder nobody asked for. Measured on the real
// Memphis pool at 7:30pm on a Tuesday, average finalScore by price level:
//
//     $   60   |   $$   69   |   $$$   77   |   $$$$   87
//
// The top five are all price level 4, rated 4.6 to 4.7.
//
// These assertions LOCK IN today's behaviour rather than endorse it. Whether a
// stranger's first screen should be the best restaurants in the city or the
// good ones near them is a product decision, and this test exists so that
// decision gets made on purpose instead of drifting. If you are here because
// this test failed, that is the point: say which way you changed it and why.
// ============================================================================

const HERE = { lat: 35.098, lng: -89.841 };
const NOW = new Date(2026, 8, 8, 19, 30);

function coldStartRanking() {
  const g = assembleGraph(null, null);
  const pool = dedupeVenues(
    filterRecommendable(poolAsInputs() as never, { hidden: null }),
  ) as unknown as Array<{ name: string; price_level?: number | null }>;
  return pool
    .map((r) => ({ r, final: scoreRestaurant(g, r as never, { here: HERE, now: NOW, mode: "browsing" }).finalScore }))
    .sort((a, b) => b.final - a.final);
}

function avgByPrice(rows: ReturnType<typeof coldStartRanking>) {
  const by = new Map<number, number[]>();
  for (const x of rows) {
    const p = x.r.price_level;
    if (typeof p !== "number") continue;
    by.set(p, [...(by.get(p) ?? []), x.final]);
  }
  return new Map([...by].map(([p, v]) => [p, Math.round(v.reduce((a, b) => a + b, 0) / v.length)]));
}

describe("a brand-new account's Home", () => {
  const ranked = coldStartRanking();

  it("has something to show at all, and the eligibility gate has run", () => {
    // 200 raw rows, 161 after chains, non-food and duplicates are dropped.
    expect(ranked.length).toBeGreaterThan(100);
    expect(ranked.length).toBeLessThan(poolAsInputs().length);
  });

  it("orders them: the tie-heavy compatibility score is not what ranks Home", () => {
    // computeCompatibility alone gives 161 places about 10 distinct values.
    // finalScore carries distance, opening hours and the gems boost, and that
    // is what Home sorts on.
    const distinct = new Set(ranked.map((x) => x.final)).size;
    expect(distinct).toBeGreaterThan(25);
  });

  it("currently ranks strictly by price, which nobody chose", () => {
    const avg = avgByPrice(ranked);
    const p1 = avg.get(1)!, p2 = avg.get(2)!, p3 = avg.get(3)!, p4 = avg.get(4)!;
    expect(p1).toBeLessThan(p2);
    expect(p2).toBeLessThan(p3);
    expect(p3).toBeLessThan(p4);
    // The gap end to end is large, not incidental.
    expect(p4 - p1).toBeGreaterThan(15);
  });

  it("fills its top five with the most expensive places in the pool", () => {
    const top5 = ranked.slice(0, 5);
    const expensive = top5.filter((x) => (x.r.price_level ?? 0) >= 3).length;
    expect(expensive).toBe(5);
  });

  it("still excludes chains, so this is a ranking problem and not a gate problem", () => {
    const names = ranked.slice(0, 20).map((x) => x.r.name.toLowerCase());
    for (const chain of ["crumbl", "ruth's chris", "starbucks", "chick-fil-a"]) {
      expect(names.some((n) => n.includes(chain))).toBe(false);
    }
  });
});
