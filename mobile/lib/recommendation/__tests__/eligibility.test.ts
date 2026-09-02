import { isNationalChainName, normalizeBrand } from "../chains";
import { isRecommendable, filterRecommendable } from "../eligibility";
import { isRecIneligible } from "../gems";
import type { RestaurantInput } from "../types";

function r(p: Partial<RestaurantInput>): RestaurantInput {
  return { google_place_id: "x", name: "X", ...p };
}

// The reported bug: a tester's Home tab recommended Domino's Pizza at 31%
// match while the place-detail screen for the same venue said "National chain
// — not surfaced in discovery". The venue was unclassified, so chain_name and
// recommendation_eligibility were both null and every `eligibility > 0` check
// passed it through.
describe("national chain name matching", () => {
  it("normalizes store-listing noise down to the brand", () => {
    expect(normalizeBrand("Domino's Pizza")).toBe("dominos pizza");
    expect(normalizeBrand("Domino's Pizza - Newport News")).toBe("dominos pizza");
    expect(normalizeBrand("McDonald's (Store #4521)")).toBe("mcdonalds");
    expect(normalizeBrand("Chick-fil-A")).toBe("chick fil a");
  });

  it("matches known chains through real-world listing variants", () => {
    expect(isNationalChainName("Domino's Pizza")).toBe(true);
    expect(isNationalChainName("Domino's Pizza #4521")).toBe(true);
    expect(isNationalChainName("Domino's Pizza - Newport News")).toBe(true);
    expect(isNationalChainName("McDonald's")).toBe(true);
    expect(isNationalChainName("Chipotle Mexican Grill")).toBe(true);
    expect(isNationalChainName("Sonic Drive-In")).toBe(true);
    expect(isNationalChainName("IHOP")).toBe(true);
  });

  it("does NOT match independents that merely start with a brand word", () => {
    // The expensive failure mode: suppressing a real restaurant is invisible
    // to us and unrecoverable for the user, so the matcher stays conservative.
    expect(isNationalChainName("Sonic Boom Ramen")).toBe(false);
    expect(isNationalChainName("Subway Sandwich Shop of Brooklyn Heights")).toBe(false);
    expect(isNationalChainName("Little Sheep Mongolian Hot Pot")).toBe(false);
    expect(isNationalChainName("Papa Luigi's Trattoria")).toBe(false);
    expect(isNationalChainName("Arsicault Bakery")).toBe(false);
    expect(isNationalChainName("")).toBe(false);
    expect(isNationalChainName(null)).toBe(false);
  });
});

describe("the hard gate catches unclassified chains", () => {
  it("excludes Domino's with null chain_name and null eligibility", () => {
    const dominos = r({
      name: "Domino's Pizza",
      chain_name: null,
      recommendation_eligibility: null,
      format_class: null,
    });
    expect(isRecIneligible(dominos)).toBe(true);
    expect(isRecommendable(dominos)).toBe(false);
  });

  it("excludes a venue the DB flagged as a chain brand", () => {
    expect(isRecommendable(r({ name: "Mama's Pizza", is_chain_brand: true }))).toBe(false);
    expect(isRecommendable(r({ name: "Mama's Pizza", is_chain_brand: false, rating: 4.5, user_rating_count: 300 }))).toBe(true);
  });

  it("still admits a cheap independent taqueria", () => {
    const taqueria = r({
      name: "Taqueria La Bamba",
      format_class: "quick_service",
      primary_type: "mexican_restaurant",
      types: ["restaurant", "mexican_restaurant"],
      rating: 4.7,
      user_rating_count: 250,
      price_level: 1,
      recommendation_eligibility: 1,
    });
    expect(isRecommendable(taqueria)).toBe(true);
  });
});

describe("filterRecommendable", () => {
  const gem = r({
    google_place_id: "gem",
    name: "Kissaki Omakase",
    rating: 4.7,
    user_rating_count: 400,
    price_level: 4,
    recommendation_eligibility: 1,
  });
  const chain = r({ google_place_id: "chain", name: "Domino's Pizza" });
  const ordinaryCafe = r({
    google_place_id: "cafe",
    name: "Corner Coffee",
    primary_type: "coffee_shop",
    rating: 4.0,
    user_rating_count: 90,
  });

  it("drops chains and non-gem cafés, keeps gems", () => {
    const out = filterRecommendable([gem, chain, ordinaryCafe]);
    expect(out.map((x) => x.google_place_id)).toEqual(["gem"]);
  });

  it("admits cafés when the surface is about cafés", () => {
    const out = filterRecommendable([gem, chain, ordinaryCafe], { cafes: "allow" });
    expect(out.map((x) => x.google_place_id)).toEqual(["gem", "cafe"]);
  });

  it("preserves the caller's row type (DB rows keep their extra fields)", () => {
    const rows = [{ ...gem, address: "1 Main St" }];
    expect(filterRecommendable(rows)[0].address).toBe("1 Main St");
  });
});
