import { cafeTimeMultiplier, rankSavesRecs } from "../recs-from-saves";

// 2026-09-03 is a Thursday.
const at = (h: number, m = 0) => new Date(2026, 8, 3, h, m);

function rec(name: string, totalScore: number, format_class: string | null) {
  return { name, totalScore, format_class };
}

// Home's "Based on your saves" rail recommended a smoothie café and a coffee
// shop at 11:57pm, anchored on three dinner restaurants. The ranked Discover
// path has demoted cafés by time of day for a while; this rail ordered purely
// by the RPC's similarity score and never applied it.
describe("cafeTimeMultiplier", () => {
  it("leaves a coffee shop alone at breakfast", () => {
    // Not a compromise at 8am — it is the right answer.
    expect(cafeTimeMultiplier("café", at(8))).toBe(1);
  });

  it("demotes harder as the day goes on", () => {
    const lunch = cafeTimeMultiplier("café", at(12));
    const dinner = cafeTimeMultiplier("café", at(19));
    const lateNight = cafeTimeMultiplier("café", at(23, 57));
    expect(lunch).toBeLessThan(1);
    expect(dinner).toBeLessThan(lunch);
    expect(lateNight).toBeLessThan(dinner);
  });

  it("does not touch restaurants at any hour", () => {
    for (const h of [8, 12, 19, 23]) {
      expect(cafeTimeMultiplier("restaurant", at(h))).toBe(1);
      expect(cafeTimeMultiplier(null, at(h))).toBe(1);
    }
  });

  it("inverts for dessert, which is a good late call and a bad early one", () => {
    expect(cafeTimeMultiplier("dessert", at(23))).toBeGreaterThan(
      cafeTimeMultiplier("dessert", at(8)),
    );
  });

  it("backs off for someone who genuinely lives in cafés", () => {
    const casual = cafeTimeMultiplier("café", at(19), { restaurant: 100 });
    const regular = cafeTimeMultiplier("café", at(19), { "café": 40, restaurant: 60 });
    expect(regular).toBeGreaterThan(casual);
  });

  it("never demotes to nothing — a café is still a real place", () => {
    expect(cafeTimeMultiplier("café", at(23, 57))).toBeGreaterThan(0.1);
  });
});

describe("rankSavesRecs", () => {
  it("puts the dinner restaurant above the smoothie café at midnight", () => {
    // The exact shape of the reported bug: cafés outscored a restaurant on raw
    // similarity, so they led the rail at 11:57pm.
    const ranked = rankSavesRecs([
      rec("Bora Bora Smoothie Cafe", 90, "café"),
      rec("Dr. Bean's Coffee", 88, "café"),
      rec("Sai Biryani point", 70, "restaurant"),
    ], at(23, 57));

    expect(ranked[0].name).toBe("Sai Biryani point");
  });

  it("leaves the same list alone at 8am", () => {
    const ranked = rankSavesRecs([
      rec("Bora Bora Smoothie Cafe", 90, "café"),
      rec("Sai Biryani point", 70, "restaurant"),
    ], at(8));

    expect(ranked.map((r) => r.name)).toEqual(["Bora Bora Smoothie Cafe", "Sai Biryani point"]);
  });

  it("does not mutate the array it was given", () => {
    const input = [rec("a", 10, "café"), rec("b", 20, "restaurant")];
    const copy = [...input];
    rankSavesRecs(input, at(23));
    expect(input).toEqual(copy);
  });
});
