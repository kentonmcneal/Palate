import { assembleGraph, emptyVector } from "../taste-graph";
import { getCompatibility, invalidateCompatibilityCache, computeCompatibility } from "../index";
import type { RestaurantInput } from "../types";
const r: RestaurantInput = { google_place_id: "synthetic-cache-place", name: "Fixture", cuisine_type: "italian", cuisine_region: "italian", rating: 4.5, user_rating_count: 200, price_level: 2, format_class: "casual_dining" };
const graph = (cuisine: string) => {
  const v = emptyVector();
  v.visitCount = 20;
  v.cuisineType = { [cuisine]: 20 };
  v.cuisineRegion = { [cuisine]: 20 };
  return assembleGraph(v, null);
};
beforeEach(invalidateCompatibilityCache);
test("different taste profiles with identical totals do not share scores", () => {
  const italian = graph("italian"), thai = graph("thai");
  const first = getCompatibility(italian, r);
  const second = getCompatibility(thai, r);
  expect(second).toEqual(computeCompatibility(thai, r));
  expect(second.score).not.toBe(first.score);
});
test("editing a rating without changing map size refreshes its match", () => {
  const g = graph("italian");
  g.placeSentiment.set(r.google_place_id, { loved: 1, ok: 0, not_for_me: 0 });
  const before = getCompatibility(g, r);
  g.placeSentiment.set(r.google_place_id, { loved: 0, ok: 0, not_for_me: 1 });
  const after = getCompatibility(g, r);
  expect(after).toEqual(computeCompatibility(g, r));
  expect(after.score).not.toBe(before.score);
});
test("enriched restaurant data cannot retain the old catalog score", () => {
  const g = graph("italian");
  const sparse = { google_place_id: r.google_place_id, name: r.name };
  const before = getCompatibility(g, sparse);
  const after = getCompatibility(g, r);
  expect(after).toEqual(computeCompatibility(g, r));
  expect(after).not.toBe(before);
});
test("equivalent snapshots reuse a cached result and implicit feedback does not invalidate it", () => {
  const g = graph("italian");
  const before = getCompatibility(g, r);
  expect(getCompatibility({ ...g, cuisines: { ...g.cuisines } }, { ...r })).toBe(before);
  expect(getCompatibility({ ...g, feedbackByPlace: new Map() }, r)).toBe(before);
});
