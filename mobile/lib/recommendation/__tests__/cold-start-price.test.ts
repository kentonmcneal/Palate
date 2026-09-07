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
  it("spends nine points on price alone, $ to $$$$", () => {
    // Was 18 until 2026-09-07. Compressed so that six rating points outweigh
    // the entire price range, which is what "lead with ratings" requires.
    const cheap = gemAdjustment(place({ price_level: 1 }));
    const dear = gemAdjustment(place({ price_level: 4 }));
    expect(dear - cheap).toBe(9);
  });

  // ------------------------------------------------------------------------
  // The inversion that prompted the change, now the right way round.
  //
  // Before 2026-09-07, priceUpscale spent 18 points against qualityQuadrant's
  // -10..+16, so a mediocre expensive restaurant beat an excellent cheap one:
  //
  //   4.8 stars, $     -8 + 10 + 6 =  +8      3.8 stars, $$$$ +10 - 6 + 6 = +10
  //
  // Worth noting how that was missed at first: comparing the two terms' RANGES
  // suggested ratings led. Ranges do not order anything. The per-place
  // arithmetic does, and it said the opposite.
  // ------------------------------------------------------------------------
  it("lets an excellent cheap place beat a mediocre expensive one", () => {
    const goodCheap = gemAdjustment(place({ price_level: 1, rating: 4.8, user_rating_count: 800 }));
    const dullDear = gemAdjustment(place({ price_level: 4, rating: 3.8, user_rating_count: 800 }));
    expect(goodCheap).toBe(13);
    expect(dullDear).toBe(6);
    expect(goodCheap).toBeGreaterThan(dullDear);
  });

  it("makes a 4.2-star $$$$ against a 4.8-star $ close to a tie", () => {
    // Was a ten-point gap. Now one. The upmarket lean survives — the founder
    // asked for it — but it no longer decides the question on its own, and
    // half a rating point is enough to overturn it.
    const excellentCheap = gemAdjustment(place({ price_level: 1, rating: 4.8, user_rating_count: 800 }));
    const decentDear = gemAdjustment(place({ price_level: 4, rating: 4.2, user_rating_count: 800 }));
    expect(decentDear - excellentCheap).toBe(1);
  });

  it("keeps the upmarket lean the founder asked for, all else equal", () => {
    expect(gemAdjustment(place({ price_level: 4 }))).toBeGreaterThan(gemAdjustment(place({ price_level: 2 })));
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

  it("no longer starts a taqueria eight points down", () => {
    // gems.ts refuses to hard-EXCLUDE cheap independents, naming "taquerias,
    // banh mi, dumpling counters", and then used to penalise them by 8 anyway.
    // Still a hint, at -3, but a hint a good rating clears easily.
    expect(gemAdjustment(place({ price_level: 1, rating: 4.5, user_rating_count: 800 }))).toBeGreaterThan(0);
  });
});
