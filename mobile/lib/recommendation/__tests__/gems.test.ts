import { isRecIneligible, isCafeFormat, isGem, gemAdjustment } from "../gems";
import type { RestaurantInput } from "../types";

function r(p: Partial<RestaurantInput>): RestaurantInput {
  return { google_place_id: "x", name: "X", ...p };
}

describe("gems-first hard gate", () => {
  it("excludes real fast food, chains, and downranked venues", () => {
    expect(isRecIneligible(r({ format_class: "fast_food" }))).toBe(true);
    expect(isRecIneligible(r({ chain_name: "Chipotle" }))).toBe(true);
    expect(isRecIneligible(r({ recommendation_eligibility: 0.2 }))).toBe(true);
  });
  it("does NOT exclude a cheap independent gem mislabeled quick_service (price proxy)", () => {
    // The classifier tags any price<=1 venue "quick_service" — a taqueria must
    // survive. Only Google's explicit fast-food types hard-exclude.
    const taqueria = r({
      format_class: "quick_service",
      primary_type: "mexican_restaurant",
      types: ["restaurant", "mexican_restaurant"],
      rating: 4.7,
      user_rating_count: 250,
      price_level: 1,
      recommendation_eligibility: 1,
    });
    expect(isRecIneligible(taqueria)).toBe(false);
  });
  it("does NOT exclude an unclassified (null-eligibility) sit-down place", () => {
    expect(isRecIneligible(r({ format_class: "restaurant", recommendation_eligibility: null }))).toBe(false);
  });
  it("catches fast food / cafés from raw Google types before classification", () => {
    expect(isRecIneligible(r({ primary_type: "fast_food_restaurant" }))).toBe(true);
    expect(isRecIneligible(r({ types: ["meal_takeaway", "food"] }))).toBe(true);
    expect(isCafeFormat(r({ primary_type: "coffee_shop" }))).toBe(true);
  });
  it("flags café formats", () => {
    expect(isCafeFormat(r({ format_class: "café" }))).toBe(true);
    expect(isCafeFormat(r({ format_class: "coffee_shop" }))).toBe(true);
    expect(isCafeFormat(r({ format_class: "restaurant" }))).toBe(false);
  });
});

describe("gem ranking", () => {
  it("rates a hard-to-find high-quality upscale spot as a gem", () => {
    const gem = r({
      format_class: "fine_dining",
      rating: 4.7,
      user_rating_count: 600,
      price_level: 3,
      vibe: "romantic",
    });
    expect(isGem(gem)).toBe(true);
    expect(gemAdjustment(gem)).toBeGreaterThan(15);
  });

  it("ranks a cheap high-traffic tourist spot BELOW the gem", () => {
    const touristy = r({ rating: 4.1, user_rating_count: 15000, price_level: 1, tags: ["tourist-heavy"] });
    const gem = r({ rating: 4.7, user_rating_count: 600, price_level: 3, vibe: "rooftop" });
    expect(gemAdjustment(gem)).toBeGreaterThan(gemAdjustment(touristy));
    expect(gemAdjustment(touristy)).toBeLessThan(0);
  });

  it("rewards an under-the-radar neighborhood gem over a mainstream magnet", () => {
    const hidden = r({ rating: 4.6, user_rating_count: 300, price_level: 2 });
    const magnet = r({ rating: 4.3, user_rating_count: 12000, price_level: 2 });
    expect(gemAdjustment(hidden)).toBeGreaterThan(gemAdjustment(magnet));
  });

  it("lets an exceptional café through the gate but not an ordinary one", () => {
    const specialCafe = r({ format_class: "café", rating: 4.8, user_rating_count: 900, price_level: 3, vibe: "aesthetic" });
    const ordinaryCafe = r({ format_class: "café", rating: 4.1, user_rating_count: 80, price_level: 1 });
    expect(isGem(specialCafe)).toBe(true);
    expect(isGem(ordinaryCafe)).toBe(false);
  });
});
