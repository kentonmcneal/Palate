import { computeCompatibility } from "../compatibility";
import { founderGraph } from "./ranking-harness.test";
import type { TasteGraph } from "../taste-graph";
import type { RestaurantInput } from "../types";

// ============================================================================
// A dish rating has to help the kitchen that cooked it.
// ----------------------------------------------------------------------------
// Until 2026-09-07 menu_item_ratings reached two maps: one keyed by cuisine,
// and one keyed by restaurants.id. The scorer reads neither — it works in
// google_place_id — so rating a dish "loved" raised every OTHER restaurant of
// that cuisine and did precisely nothing for the one whose food you had just
// praised. It was populated, it was never read, and nothing failed.
//
// These assertions are about direction and ordering, not exact points, so a
// future reweighting is free to change the magnitude.
// ============================================================================

const PLACE: RestaurantInput = {
  google_place_id: "place-under-test",
  name: "Test Kitchen",
  cuisine_type: "vietnamese",
  latitude: 35.098,
  longitude: -89.841,
} as unknown as RestaurantInput;

function graphWithDish(
  loved: number,
  not_for_me: number,
  placeId = PLACE.google_place_id,
): TasteGraph {
  const g = founderGraph();
  return {
    ...g,
    itemSentimentByPlace: new Map([[placeId, { loved, ok: 0, not_for_me }]]),
  };
}

// `score`, the headline 0..100 match. computeCompatibility returns no
// finalScore — reading one gives undefined, and every comparison against
// undefined is quietly false, which is how the first draft of this file
// "passed" three assertions that proved nothing.
const scoreOf = (g: TasteGraph) => computeCompatibility(g, PLACE).score;

describe("dish ratings reach the restaurant they were left at", () => {
  it("raises the place when its dishes were loved", () => {
    expect(scoreOf(graphWithDish(2, 0))).toBeGreaterThan(scoreOf(graphWithDish(0, 0)));
  });

  it("lowers the place when its dishes were not for you", () => {
    expect(scoreOf(graphWithDish(0, 2))).toBeLessThan(scoreOf(graphWithDish(0, 0)));
  });

  it("nets loved against not_for_me rather than counting only the good news", () => {
    expect(scoreOf(graphWithDish(2, 2))).toBe(scoreOf(graphWithDish(0, 0)));
  });

  it("changes nothing for a DIFFERENT restaurant, which was the whole bug", () => {
    expect(scoreOf(graphWithDish(3, 0, "some-other-place"))).toBe(scoreOf(graphWithDish(0, 0)));
  });

  it("weighs a dish below a visit rating: loving the food is a narrower claim", () => {
    const base = founderGraph();
    const dish = { ...base, itemSentimentByPlace: new Map([[PLACE.google_place_id, { loved: 1, ok: 0, not_for_me: 0 }]]) };
    const visit = { ...base, placeSentiment: new Map([[PLACE.google_place_id, { loved: 1, ok: 0, not_for_me: 0 }]]) };
    const none = scoreOf(base);
    expect(scoreOf(dish)).toBeGreaterThan(none);
    expect(scoreOf(dish) - none).toBeLessThan(scoreOf(visit) - none);
  });

  it("does not throw on a graph assembled before the field existed", () => {
    const stale = { ...founderGraph() } as TasteGraph;
    delete (stale as Partial<TasteGraph>).itemSentimentByPlace;
    expect(() => computeCompatibility(stale, PLACE)).not.toThrow();
  });

  it("stays bounded, so a hundred rated dishes cannot dominate the score", () => {
    // Measured: base 42, two loved dishes 45, a hundred loved dishes also 45.
    // The clamp is the point — enthusiasm is not evidence in proportion.
    expect(scoreOf(graphWithDish(100, 0))).toBe(scoreOf(graphWithDish(2, 0)));
    expect(scoreOf(graphWithDish(100, 0))).toBeGreaterThan(scoreOf(graphWithDish(0, 0)));
  });
});
