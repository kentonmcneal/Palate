import {
  buildMoodChips,
  palateRead,
  applyMood,
  cuisineLabel,
  SURPRISE,
} from "../mood";

const breakdown = [
  { cuisine: "american", count: 12, pct: 40 },
  { cuisine: "mexican", count: 6, pct: 20 },
  { cuisine: "italian", count: 4, pct: 13 },
  { cuisine: "other", count: 4, pct: 13 },
  { cuisine: "thai", count: 1, pct: 3 },
];

describe("mood chips", () => {
  it("offers Anything, Somewhere new, the user's real habits, then Surprise me", () => {
    const chips = buildMoodChips(breakdown);
    expect(chips.map((c) => c.label)).toEqual([
      "Anything", "Somewhere new",
      "American", "Mexican", "Italian", "Surprise me",
    ]);
  });

  it("drops the classifier's 'other' bucket — nobody is in the mood for other", () => {
    expect(buildMoodChips(breakdown).some((c) => c.key === "other")).toBe(false);
  });

  it("drops one-off cuisines once there are real habits to show instead", () => {
    expect(buildMoodChips(breakdown).some((c) => c.key === "thai")).toBe(false);
  });

  it("falls back to every cuisine when the user has barely any history", () => {
    // Real data from the founder's account: american:2, bar:1, cafe:1,
    // mediterranean:1. Requiring 2+ visits left exactly ONE chip, which is a
    // worse answer than showing the four things he has actually eaten.
    const sparse = [
      { cuisine: "american", count: 2, pct: 40 },
      { cuisine: "bar", count: 1, pct: 20 },
      { cuisine: "cafe", count: 1, pct: 20 },
      { cuisine: "mediterranean", count: 1, pct: 20 },
    ];
    const labels = buildMoodChips(sparse).map((c) => c.label);
    expect(labels).toEqual([
      "Anything", "Somewhere new",
      "American", "Bar", "Cafe", "Mediterranean", "Surprise me",
    ]);
  });

  it("still offers the intents on a brand-new account", () => {
    // Quick / Sit down / Somewhere new need no history, so the row is useful
    // from day one — it used to collapse to Anything + Surprise and hide.
    const labels = buildMoodChips([]).map((c) => c.label);
    expect(labels).toEqual(["Anything", "Somewhere new"]);
  });

  it("drops Surprise me until there is a usual to be surprised away from", () => {
    expect(buildMoodChips([]).map((c) => c.key)).not.toContain("surprise");
  });
});

describe("palate read", () => {
  it("names the dominant cuisine", () => {
    expect(palateRead(breakdown)).toBe("Your palate's been American lately.");
  });

  it("says nothing when there isn't enough history to be true", () => {
    expect(palateRead([{ cuisine: "thai", count: 1, pct: 100 }])).toBeNull();
    expect(palateRead([])).toBeNull();
  });
});

describe("applyMood", () => {
  const recs = [
    { google_place_id: "a", cuisine: "american", matchScore: 90 },
    { google_place_id: "b", cuisine: "mexican", matchScore: 80 },
    { google_place_id: "c", cuisine: "mexican", matchScore: 70 },
    { google_place_id: "d", cuisine: "korean", matchScore: 60 },
  ];

  it("leaves the list alone for Anything", () => {
    expect(applyMood(recs, null, []).items).toHaveLength(4);
  });

  it("narrows to one cuisine but keeps personal ranking — best Mexican FOR YOU", () => {
    const { items, matched } = applyMood(recs, "mexican", ["american"]);
    expect(matched).toBe(true);
    expect(items.map((r) => r.google_place_id)).toEqual(["b", "c"]);
    // Order preserved: b outranks c because the taste graph says so, not
    // because it is more Mexican.
    expect(items[0].matchScore).toBeGreaterThan(items[1].matchScore);
  });

  it("Surprise me excludes what the user always eats", () => {
    const { items } = applyMood(recs, SURPRISE, ["american", "mexican"]);
    expect(items.map((r) => r.google_place_id)).toEqual(["d"]);
  });

  it("never returns an empty Home — falls back and flags it", () => {
    const { items, matched } = applyMood(recs, "ethiopian", ["american"]);
    expect(matched).toBe(false);
    expect(items).toHaveLength(4);
  });

  it("is case-insensitive about cuisine strings", () => {
    const { items } = applyMood(
      [{ google_place_id: "a", cuisine: "Mexican" }],
      "mexican",
      [],
    );
    expect(items).toHaveLength(1);
  });
});

describe("cuisineLabel", () => {
  it("humanizes classifier slugs", () => {
    expect(cuisineLabel("fast_casual")).toBe("Fast Casual");
    expect(cuisineLabel("mexican")).toBe("Mexican");
  });
});
