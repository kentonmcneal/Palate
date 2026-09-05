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
