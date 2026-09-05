import { buildDishChips, applyMood, dishMood, isDishMood, moodLabel, moodFallbackNote } from "../mood";

// Nobody is in the mood for "Latin American". They want tacos.
describe("dish moods", () => {
  const breakdown = [{ cuisine: "american", count: 4, pct: 50 }, { cuisine: "mexican", count: 3, pct: 40 }] as any;
  const pool = [{ cuisine_type: "american" }, { cuisine_type: "italian" }];
  const dishes = [
    { dish: "coffee", place_count: 9 }, { dish: "tacos", place_count: 7 },
    { dish: "burgers", place_count: 6 }, { dish: "pizza", place_count: 3 },
  ];

  it("puts dishes right after the intents, drinks excluded", () => {
    const labels = buildDishChips(breakdown, pool, dishes).map((c) => c.label);
    expect(labels.slice(0, 5)).toEqual(["Anything", "Somewhere new", "Tacos", "Burgers", "Pizza"]);
    expect(labels).not.toContain("Coffee");
    expect(labels[labels.length - 1]).toBe("Surprise me");
    expect(labels).toContain("Italian");
  });

  it("filters by dish family, order preserved", () => {
    const list = [
      { name: "a", cuisine: "american", dish_family: ["burgers", "wings"] },
      { name: "b", cuisine: "mexican", dish_family: ["tacos"] },
      { name: "c", cuisine: "american", dish_family: [] },
    ];
    const { items, matched } = applyMood(list, dishMood("tacos"), []);
    expect(matched).toBe(true);
    expect(items.map((r) => r.name)).toEqual(["b"]);
  });

  it("falls back, and says so in the dish's own words", () => {
    const list = [{ name: "a", cuisine: "american", dish_family: ["burgers"] }];
    const { matched } = applyMood(list, dishMood("ramen"), []);
    expect(matched).toBe(false);
    expect(moodFallbackNote(dishMood("ramen"))).toMatch(/ramen/);
  });

  it("labels and namespaces", () => {
    expect(isDishMood(dishMood("pizza"))).toBe(true);
    expect(isDishMood("italian")).toBe(false);
    expect(moodLabel(dishMood("fried_chicken"))).toBe("Fried chicken");
    expect(moodLabel("italian")).toBe("Italian");
  });
});
