import { scoreContext, scoreRestaurant } from "../scoring";
import { assembleGraph, emptyVector } from "../taste-graph";
import type { RestaurantInput } from "../types";

const restaurant: RestaurantInput = { google_place_id: "synthetic-location", name: "Fixture", latitude: 40.7, longitude: -74 };
const here = { lat: 40.7, lng: -74 };

test("malformed restaurant coordinates have the same context as missing coordinates", () => {
  const neutral = scoreContext({ ...restaurant, latitude: null, longitude: null }, { here });
  for (const [latitude, longitude] of [[NaN, -74], [Infinity, -74], [91, 0], [0, -181]]) {
    const r = { ...restaurant, latitude, longitude };
    expect(scoreContext(r, { here })).toBe(neutral);
    const score = scoreRestaurant(assembleGraph(emptyVector(), null), r, { here });
    expect(Number.isFinite(score.finalScore)).toBe(true);
  }
});
test("malformed user coordinates do not corrupt candidate ranking", () => {
  for (const bad of [{ lat: NaN, lng: 0 }, { lat: 0, lng: Infinity }, { lat: -91, lng: 0 }, { lat: 0, lng: 181 }]) {
    expect(scoreContext(restaurant, { here: bad })).toBe(scoreContext(restaurant, {}));
  }
});
test("zero and geographic boundary coordinates remain valid", () => {
  for (const point of [{ lat: 0, lng: 0 }, { lat: 90, lng: 180 }, { lat: -90, lng: -180 }]) {
    const atPoint = { ...restaurant, latitude: point.lat, longitude: point.lng };
    expect(scoreContext(atPoint, { here: point })).toBeGreaterThan(scoreContext(atPoint, {}));
  }
});
