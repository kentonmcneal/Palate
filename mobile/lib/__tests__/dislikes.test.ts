jest.mock("../supabase", () => ({ supabase: {} }));

import { buildDislikeProfile, dislikePenalty, EMPTY_DISLIKES, type DislikeRow } from "../dislikes";

const row = (over: Partial<DislikeRow>): DislikeRow => ({
  google_place_id: "p", reason: "place", cuisine_type: null, cuisine_subregion: null,
  format_class: null, dish_family: null, price_level: null, neighborhood: null,
  created_at: "2026-09-05T00:00:00Z", ...over,
});

describe("not interested", () => {
  it("costs nothing when nobody has said no to anything", () => {
    expect(dislikePenalty(EMPTY_DISLIKES, { google_place_id: "x", cuisine_type: "italian" })).toBe(0);
  });

  it("'not into this food' hits the same cuisine hard and other cuisines not at all", () => {
    const p = buildDislikeProfile([row({ google_place_id: "a", reason: "food", cuisine_type: "steakhouse", dish_family: ["steak"] })]);
    const steak = dislikePenalty(p, { google_place_id: "b", cuisine_type: "steakhouse", dish_family: ["steak"] });
    const thai = dislikePenalty(p, { google_place_id: "c", cuisine_type: "thai" });
    expect(steak).toBeGreaterThanOrEqual(8);
    expect(thai).toBe(0);
  });

  it("'just this place' is a nudge, not a verdict", () => {
    const p = buildDislikeProfile([row({ google_place_id: "a", reason: "place", cuisine_type: "steakhouse" })]);
    const food = buildDislikeProfile([row({ google_place_id: "a", reason: "food", cuisine_type: "steakhouse" })]);
    const nudge = dislikePenalty(p, { google_place_id: "b", cuisine_type: "steakhouse" });
    const verdict = dislikePenalty(food, { google_place_id: "b", cuisine_type: "steakhouse" });
    expect(nudge).toBeGreaterThan(0);
    expect(nudge).toBeLessThan(verdict);
  });

  it("saturates: the fifth no is bigger than the first, but never unbounded", () => {
    const one = buildDislikeProfile([row({ google_place_id: "a", reason: "food", cuisine_type: "indian" })]);
    const five = buildDislikeProfile(Array.from({ length: 5 }, (_, i) => row({ google_place_id: `a${i}`, reason: "food", cuisine_type: "indian" })));
    const p1 = dislikePenalty(one, { google_place_id: "z", cuisine_type: "indian" });
    const p5 = dislikePenalty(five, { google_place_id: "z", cuisine_type: "indian" });
    expect(p5).toBeGreaterThan(p1);
    expect(p5).toBeLessThanOrEqual(30);
  });

  it("forty taco visits outweigh one dismissed taqueria", () => {
    const p = buildDislikeProfile([row({ google_place_id: "a", reason: "food", cuisine_type: "mexican", dish_family: ["tacos"] })]);
    const cold = dislikePenalty(p, { google_place_id: "b", cuisine_type: "mexican", dish_family: ["tacos"] }, 0);
    const warm = dislikePenalty(p, { google_place_id: "b", cuisine_type: "mexican", dish_family: ["tacos"] }, 40);
    expect(warm).toBeLessThan(cold / 3);
  });

  it("'too pricey' learns the tier, not the cuisine", () => {
    const p = buildDislikeProfile([row({ google_place_id: "a", reason: "price", cuisine_type: "french", price_level: 4 })]);
    const pricey = dislikePenalty(p, { google_place_id: "b", cuisine_type: "italian", price_level: 4 });
    const cheapFrench = dislikePenalty(p, { google_place_id: "c", cuisine_type: "french", price_level: 1 });
    expect(pricey).toBeGreaterThan(cheapFrench);
  });

  it("the place itself is in the exclusion set", () => {
    const p = buildDislikeProfile([row({ google_place_id: "gone" })]);
    expect(p.placeIds.has("gone")).toBe(true);
  });
});
