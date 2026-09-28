import type { Restaurant } from "../../places";
/** Synthetic 2,000-venue grid (~5 km²), using the Memphis catalogue shape. */
export const denseCity: Restaurant[] = Array.from({ length: 2000 }, (_, i) => ({
  google_place_id: `synthetic-nyc-${i}`, name: `Fixture Restaurant ${i}`,
  latitude: 40.74 + Math.floor(i / 50) * 0.0005, longitude: -74 + (i % 50) * 0.00053,
  primary_type: "restaurant", types: ["restaurant", "food"],
  cuisine_type: ["italian", "chinese", "mexican", "indian"][i % 4],
  price_level: 1 + i % 3, rating: 3.5 + (i % 15) / 10, user_rating_count: 10 + i,
}));
