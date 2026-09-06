import { buildDishChips, applyMood, dishMood, isDishMood, moodLabel, moodFallbackNote, moodContextNote } from "../mood";

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

// The founder's report, three times: "the toggles are still not shuffling
// suggestions." Two causes, one per chip class.
describe("a chip must change the list", () => {
  const place = (name: string, cuisine: string, visited = false, dish: string[] = []) =>
    ({ name, cuisine, dish_family: dish, format_class: "casual_dining", visited });

  it("Somewhere new re-ranks when nothing is visited, instead of returning the same order", () => {
    // Everything nearby is unvisited, so filtering on "not visited" changed
    // nothing and the top three stayed put.
    const list = [
      place("Usual American", "american"),
      place("Usual Burger", "american"),
      place("Thai Place", "thai"),
      place("Ethiopian Place", "african"),
    ];
    const { items, matched } = applyMood(list, "mood:new", ["american"]);
    expect(matched).toBe(true);
    expect(items[0].name).not.toBe("Usual American");
    expect(["Thai Place", "Ethiopian Place"]).toContain(items[0].name);
  });

  it("a dish chip with one local match still reports a short list, so the card tops it up", () => {
    const list = [place("Taqueria", "mexican", false, ["tacos"]), place("Diner", "american")];
    const { items, matched } = applyMood(list, dishMood("tacos"), []);
    expect(matched).toBe(true);
    expect(items).toHaveLength(1); // fewer than three → the card asks the catalogue
  });

  it("a dish chip with no local match asks the catalogue rather than showing the default", () => {
    const list = [place("Diner", "american"), place("Grill", "american")];
    const { items, matched } = applyMood(list, dishMood("ramen"), []);
    expect(matched).toBe(false);
    expect(items).toHaveLength(2); // unchanged list, but matched:false is the signal
  });
});

// ============================================================================
// Cocktail bars — the founder asked for them by name.
// ----------------------------------------------------------------------------
// Every other drink stays out of the mood row: going out for a coffee is not
// a plan. Going out for a drink is.
// ============================================================================
describe("the cocktail bars chip", () => {
  const breakdown = [{ cuisine: "american", count: 4, pct: 50 }] as any;
  const pool = [{ cuisine_type: "american" }];

  it("appears when there are cocktail bars nearby, and the other drinks do not", () => {
    const labels = buildDishChips(breakdown, pool, [
      { dish: "coffee", place_count: 15 },
      { dish: "tacos", place_count: 20 },
      { dish: "wine", place_count: 5 },
      { dish: "beer", place_count: 4 },
      { dish: "cocktails", place_count: 3 },
    ]).map((c) => c.label);
    expect(labels).toContain("Cocktail bars");
    expect(labels).not.toContain("Coffee");
    expect(labels).not.toContain("Wine");
    expect(labels).not.toContain("Beer");
  });

  it("stays out of the eight dish slots — it is appended, never sorted in", () => {
    // Nine real dishes plus cocktails. The dish limit is 8, and all eight
    // should still be meals.
    const many = Array.from({ length: 9 }, (_, i) => ({ dish: `d${i}`, place_count: 20 - i }));
    const chips = buildDishChips(breakdown, pool, [...many, { dish: "cocktails", place_count: 3 }]);
    const labels = chips.map((c) => c.label);
    expect(labels).toContain("Cocktail bars");
    // d0..d7 are the eight; d8 fell off. Cocktails did not take a slot.
    expect(labels).toContain("D7");
    expect(labels).not.toContain("D8");
  });

  it("says nothing at all when there is nowhere to go", () => {
    const labels = buildDishChips(breakdown, pool, [
      { dish: "tacos", place_count: 20 },
      { dish: "cocktails", place_count: 0 },
    ]).map((c) => c.label);
    expect(labels).not.toContain("Cocktail bars");
  });

  it("does not claim a bar is or is not your pattern", () => {
    // The compatibility score was never trained on a bar. Silence is honest.
    expect(moodContextNote(dishMood("cocktails"), 20)).toBeNull();
    expect(moodContextNote(dishMood("tacos"), 20)).not.toBeNull();
  });
});
