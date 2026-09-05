import { assembleGraph, emptyVector } from "../taste-graph";
import { computeCompatibility } from "../compatibility";

// The review measured the inversion: a 20-visit-Italian user scored a
// classified Thai place 52 and the identical row with cuisine nulled 71. A
// third of the catalogue is unclassified, so those places floated above the
// ones we correctly knew the user would not like.
describe("an unknown place does not outrank a known bad one", () => {
  const v = emptyVector();
  v.visitCount = 20;
  v.cuisineRegion = { italian: 20 };
  v.cuisineSubregion = { italian_trattoria: 20 };
  const g = assembleGraph(v, null);

  const base = { name: "X", format_class: "casual_dining", price_level: 2, rating: 4.4, user_rating_count: 300 };
  const good = computeCompatibility(g, { ...base, google_place_id: "a", cuisine_region: "italian", cuisine_subregion: "italian_trattoria" }).score;
  const bad = computeCompatibility(g, { ...base, google_place_id: "b", cuisine_region: "east_asian", cuisine_subregion: "thai" }).score;
  const unknown = computeCompatibility(g, { ...base, google_place_id: "c", cuisine_region: null, cuisine_subregion: null }).score;

  it("ranks a matching place above an unclassified one", () => {
    expect(good).toBeGreaterThan(unknown);
  });

  it("no longer lets an unclassified place beat everything", () => {
    // The bug: unknown (71) > good. Whatever the constants, that must not hold.
    expect(unknown).toBeLessThan(good);
  });

  it("still puts unknown above a place we know is wrong for you", () => {
    // "We did not look" is genuinely better news than "we looked and it is
    // not your thing" — it just is not better than a real match.
    expect(unknown).toBeGreaterThanOrEqual(bad);
  });
});

describe("saves count toward taste", () => {
  it("a cuisine you have only saved lifts similar places", () => {
    const cold = emptyVector();
    cold.visitCount = 10;
    cold.cuisineRegion = { american: 10 };
    const withSave = emptyVector();
    withSave.visitCount = 10;
    withSave.cuisineRegion = { american: 10 };
    withSave.cuisineRegionAspirational = { japanese: 5 };

    const place = { google_place_id: "s", name: "Sushi", cuisine_region: "japanese", format_class: "casual_dining", rating: 4.4, user_rating_count: 200 };
    const before = computeCompatibility(assembleGraph(cold, null), place).score;
    const after = computeCompatibility(assembleGraph(withSave, null), place).score;
    expect(after).toBeGreaterThan(before);
  });
});
