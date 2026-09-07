import { poolAsInputs, founderGraph } from "./ranking-harness.test";
import { scoreRestaurant } from "../scoring";
import { assembleGraph } from "../taste-graph";
import { filterRecommendable } from "../eligibility";
import { dedupeVenues } from "../dedupe";
import { gemAdjustment } from "../gems";

// ============================================================================
// What a stranger sees, and why. Endorsed behaviour, pinned down.
// ----------------------------------------------------------------------------
// Fifty testers will open this app with no visits, no saves and no ratings.
// Measured on the real Memphis pool at 7:30pm on a Tuesday, average finalScore
// by price level for such an account:
//
//     $  60   |   $$  69   |   $$$  77   |   $$$$  87
//
// DECIDED 2026-09-07. The founder's call: "best restaurants in the city ...
// should lead with ratings and maybe even perceive price slightly as an
// indicator of strength."
//
// THE MECHANISM, because I got this wrong twice before finding it. The ladder
// is NOT a side effect of Google ratings correlating with price. It is an
// explicit table, gems.ts priceUpscale(): $$$$ +10, $$$ +7, $$ +2, $ -8. That
// is 18 points added straight onto finalScore for every account, taste graph or
// not, which is why the founder's own ranking leans the same way despite his
// average price level sitting at 1.8.
//
// And ratings do lead it, as intended: qualityQuadrant() spans -10..+16 on
// rating and review count, against priceUpscale's -8..+10.
//
// The tension worth knowing about: gems.ts deliberately refuses to hard-exclude
// cheap independent places — its own comment names "taquerias, banh mi,
// dumpling counters" — and then starts them 18 points behind a steakhouse.
// Both of those are choices. This file records them so neither drifts.
//
// If a test here fails, the ranking a stranger sees has moved. Say which way
// and why.
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

const place = (over: Record<string, unknown>) => ({
  google_place_id: "p", name: "Place", cuisine_type: "american",
  latitude: 35.098, longitude: -89.841, rating: 4.5, user_rating_count: 500,
  ...over,
}) as never;

describe("a brand-new account's Home", () => {
  const ranked = coldStartRanking();

  it("has something to show, and the eligibility gate has run", () => {
    expect(ranked.length).toBeGreaterThan(100);
    expect(ranked.length).toBeLessThan(poolAsInputs().length);
  });

  it("is ordered by finalScore, not the tie-heavy compatibility score", () => {
    expect(new Set(ranked.map((x) => x.final)).size).toBeGreaterThan(25);
  });

  it("leans richer as price rises, deliberately", () => {
    const avg = avgByPrice(ranked);
    expect(avg.get(1)!).toBeLessThan(avg.get(2)!);
    expect(avg.get(2)!).toBeLessThan(avg.get(3)!);
    expect(avg.get(3)!).toBeLessThan(avg.get(4)!);
  });

  it("fills its top five with the pricier end of the pool", () => {
    expect(ranked.slice(0, 5).filter((x) => (x.r.price_level ?? 0) >= 3)).toHaveLength(5);
  });

  it("still excludes chains, so this is ranking and not a gate failure", () => {
    const names = ranked.slice(0, 20).map((x) => x.r.name.toLowerCase());
    for (const chain of ["crumbl", "ruth's chris", "starbucks", "chick-fil-a"]) {
      expect(names.some((n) => n.includes(chain))).toBe(false);
    }
  });
});

describe("gemAdjustment is where price actually speaks", () => {
  it("spends 18 points on price alone, $ to $$$$", () => {
    const cheap = gemAdjustment(place({ price_level: 1 }));
    const dear = gemAdjustment(place({ price_level: 4 }));
    expect(dear - cheap).toBe(18);
  });

  // ------------------------------------------------------------------------
  // NOT what the founder asked for. Recorded, not endorsed.
  //
  // "Lead with ratings and maybe even perceive price slightly as an indicator
  // of strength" — measured against the arithmetic, price does not sit behind
  // ratings at the extremes, it beats them:
  //
  //   4.8 stars, $     -8 + 10 + 6 = +8
  //   3.8 stars, $$$$ +10 -  6 + 6 = +10
  //
  // Comparing the two terms' RANGES (ratings -10..+16 against price -8..+10)
  // suggested ratings led, and that is the comparison I made first. It is the
  // wrong one: what decides an ordering is the per-place arithmetic, and there
  // a 4.2-star steakhouse clears a 4.8-star taqueria by ten points.
  // ------------------------------------------------------------------------
  it("currently lets price outrank ratings at the extremes", () => {
    const goodCheap = gemAdjustment(place({ price_level: 1, rating: 4.8, user_rating_count: 800 }));
    const dullDear = gemAdjustment(place({ price_level: 4, rating: 3.8, user_rating_count: 800 }));
    expect(goodCheap).toBe(8);
    expect(dullDear).toBe(10);
    expect(goodCheap).toBeLessThan(dullDear);
  });

  it("puts a 4.2-star $$$$ ten points above a 4.8-star $", () => {
    const excellentCheap = gemAdjustment(place({ price_level: 1, rating: 4.8, user_rating_count: 800 }));
    const decentDear = gemAdjustment(place({ price_level: 4, rating: 4.2, user_rating_count: 800 }));
    expect(decentDear - excellentCheap).toBe(10);
  });

  it("applies to everyone, taste graph or not — it is not a cold-start rule", () => {
    // The founder averages 1.8, and a $$$$ place still outranks an identical $
    // one for him, because this adjustment sits outside compatibility entirely.
    const g = founderGraph();
    const f = (price: number) =>
      scoreRestaurant(g, place({ price_level: price, google_place_id: `p${price}` }), { here: HERE, now: NOW, mode: "browsing" }).finalScore;
    expect(g.averagePriceLevel).toBeGreaterThan(0);
    expect(f(4)).toBeGreaterThan(f(1));
  });

  it("penalises the cheap independent places gems.ts says it protects", () => {
    // Not a bug — a documented trade. The module refuses to hard-EXCLUDE a
    // taqueria, then starts it 8 points down. Pinned so the day somebody wants
    // Palate to be the app that finds cheap gems, this is the line to change.
    expect(gemAdjustment(place({ price_level: 1 }))).toBeLessThan(
      gemAdjustment(place({ price_level: 2 })),
    );
  });
});
