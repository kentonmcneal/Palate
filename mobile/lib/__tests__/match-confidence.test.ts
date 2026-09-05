import { scoreMatch, MAX_ATTRIBUTE_WEIGHT } from "../match-score";
import type { TasteVector } from "../taste-vector";

// A user who eats Italian, fast casual, at brunch, cheaply.
const vector = {
  cuisineRegion: { european: 10 },
  cuisineSubregion: { italian_pizzeria: 10 },
  formatClass: { fast_casual: 10 },
  occasion: { brunch: 10 },
  flavor: { rich: 10 },
  priceTier: {},
  averagePriceLevel: 2,
  topNeighborhoods: [],
  visitCount: 20,
} as unknown as TasteVector;

const rec = { cuisine: "italian", price_level: 2, neighborhood: null };

// `raw / totalWeight` normalised over only the attributes that were PRESENT,
// so a restaurant with one populated field was judged on that field alone and
// could reach the top. Subregion is missing on 47% of the live catalogue and
// carries the heaviest weight, so the ranking partly measured how much we knew
// about a place rather than how well it fit.
describe("confidence weighting", () => {
  it("ranks a thoroughly matching restaurant above a sparse perfect one", () => {
    // Sparse: one attribute, a perfect hit on it.
    const sparse = scoreMatch(vector, rec, { cuisineSubregion: "italian_pizzeria" });

    // Rich: five attributes, four of them hits.
    const rich = scoreMatch(vector, rec, {
      cuisineSubregion: "italian_pizzeria",
      cuisineRegion: "european",
      formatClass: "fast_casual",
      occasionTags: ["brunch"],
      flavorTags: ["rich"],
    });

    expect(rich.score).toBeGreaterThan(sparse.score);
  });

  it("pulls a barely described place toward neutral rather than to the top", () => {
    const sparse = scoreMatch(vector, rec, { cuisineSubregion: "italian_pizzeria" });
    // 35 of 105 observed, so a perfect fit reaches roughly a third of the way
    // from 50 to 100 rather than all of it.
    expect(sparse.score).toBeLessThan(75);
    expect(sparse.score).toBeGreaterThan(50);
  });

  it("still lets a fully described, genuinely matching place score high", () => {
    const rich = scoreMatch(vector, rec, {
      cuisineSubregion: "italian_pizzeria",
      cuisineRegion: "european",
      formatClass: "fast_casual",
      occasionTags: ["brunch"],
      flavorTags: ["rich"],
    });
    expect(rich.score).toBeGreaterThan(80);
  });

  it("does not push a poor match UP toward neutral on thin evidence", () => {
    // Confidence pulls toward 50 from both directions. A bad fit on one
    // attribute must not be flattered into looking average-good.
    const badSparse = scoreMatch(vector, rec, { cuisineSubregion: "japanese_sushi" });
    expect(badSparse.score).toBeLessThanOrEqual(50);
  });

  it("returns the neutral floor when nothing at all is known", () => {
    // `rec` carries a price, which IS an attribute — with it, a place whose
    // only known quality is a matching price scores 55, barely off neutral,
    // which is the point. Truly nothing known is 50.
    const nothing = { cuisine: null, price_level: null, neighborhood: null } as never;
    expect(scoreMatch(vector, nothing, {}).score).toBe(50);
  });

  it("gives a place whose only known quality is price barely more than neutral", () => {
    expect(scoreMatch(vector, rec, {}).score).toBe(55);
  });

  it("sums the weights it claims to sum", () => {
    // If a weight changes in scoreMatch and not here, every score silently
    // shifts. 35 + 20 + 15 + 15 + 10 + 10.
    expect(MAX_ATTRIBUTE_WEIGHT).toBe(105);
  });
});
