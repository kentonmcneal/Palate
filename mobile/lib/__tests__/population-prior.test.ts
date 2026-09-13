import { applyPriorRows } from "../population-prior";
import type { TasteVector } from "../taste-vector";

function emptyVector(): TasteVector {
  return {
    visitCount: 0, wishlistCount: 0,
    cuisineRegion: {}, cuisineSubregion: {}, cuisineType: {},
    cuisineRegionAspirational: {}, cuisineSubregionAspirational: {},
    formatClass: {}, priceTier: {}, occasion: {}, flavor: {},
  } as unknown as TasteVector;
}

// ----------------------------------------------------------------------------
// The cold-start seed, after the starter quiz was removed.
// ----------------------------------------------------------------------------
describe("population prior", () => {
  it("nudges hardest for the most common thing", () => {
    const v = emptyVector();
    applyPriorRows(v, [
      { facet: "cuisine_type", value: "american", weight: 1.0 },
      { facet: "cuisine_type", value: "italian", weight: 0.35 },
    ]);
    // A flat add would make the tail as influential as the leader, which is
    // how a prior stops being a guess and becomes a preference.
    expect(v.cuisineType.american).toBeGreaterThan(v.cuisineType.italian);
  });

  it("routes each facet to its own map", () => {
    const v = emptyVector();
    applyPriorRows(v, [
      { facet: "cuisine_type", value: "american", weight: 1 },
      { facet: "format_class", value: "fast_casual", weight: 1 },
      { facet: "price_tier", value: "2", weight: 1 },
      { facet: "occasion", value: "group_dinner", weight: 1 },
    ]);
    expect(v.cuisineType.american).toBeGreaterThan(0);
    expect(v.formatClass.fast_casual).toBeGreaterThan(0);
    expect(v.priceTier["2"]).toBeGreaterThan(0);
    expect(v.occasion.group_dinner).toBeGreaterThan(0);
  });

  it("ignores a facet it does not know", () => {
    // The RPC can grow a facet before the client understands it, and an
    // unrecognised one must be dropped rather than land somewhere arbitrary.
    const v = emptyVector();
    applyPriorRows(v, [{ facet: "invented_facet", value: "x", weight: 1 }]);
    expect(Object.keys(v.cuisineType)).toHaveLength(0);
    expect(Object.keys(v.formatClass)).toHaveLength(0);
  });

  it("cannot be pushed outside its weight range by a bad row", () => {
    const v = emptyVector();
    applyPriorRows(v, [
      { facet: "cuisine_type", value: "wild", weight: 99 },
      { facet: "cuisine_type", value: "negative", weight: -5 },
    ]);
    expect(v.cuisineType.wild).toBeLessThanOrEqual(1);
    expect(v.cuisineType.negative).toBe(0);
  });

  it("adds to what is already there rather than replacing it", () => {
    const v = emptyVector();
    v.cuisineType.american = 2;
    applyPriorRows(v, [{ facet: "cuisine_type", value: "american", weight: 1 }]);
    expect(v.cuisineType.american).toBeGreaterThan(2);
  });
});
