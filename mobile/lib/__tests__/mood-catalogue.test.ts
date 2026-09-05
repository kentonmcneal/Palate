import {
  buildCuisineChips, nearbyCuisines, moodContextNote, SURPRISE, QUICK,
} from "../mood";

const breakdown = [
  { cuisine: "american", count: 9, pct: 0.5 },
  { cuisine: "café", count: 4, pct: 0.3 },
] as never;

const pool = [
  { cuisine_type: "steakhouse" }, { cuisine_type: "steakhouse" },
  { cuisine_type: "thai" },
  { cuisine_type: "american" },
  { cuisine_type: "other" },
  { cuisine_type: null },
];

// The chips were built from the user's OWN breakdown, so a cuisine they had
// never eaten could never be offered. Someone who does not eat steak had no way
// to ask for a steakhouse, which is exactly when you would want to.
describe("buildCuisineChips", () => {
  it("offers a cuisine the user has never eaten but that exists nearby", () => {
    const labels = buildCuisineChips(breakdown, pool).map((c) => c.label);
    expect(labels).toContain("Steakhouse");
    expect(labels).toContain("Thai");
  });

  it("keeps the user's own cuisines in front, because those get tapped", () => {
    const labels = buildCuisineChips(breakdown, pool).map((c) => c.label);
    expect(labels.indexOf("American")).toBeLessThan(labels.indexOf("Steakhouse"));
  });

  it("does not repeat a cuisine that is both a habit and nearby", () => {
    const labels = buildCuisineChips(breakdown, pool).map((c) => c.label);
    expect(labels.filter((l) => l === "American")).toHaveLength(1);
  });

  it("keeps the intents first and Surprise me last", () => {
    const chips = buildCuisineChips(breakdown, pool);
    expect(chips[0].label).toBe("Anything");
    expect(chips[1].key).toBe(QUICK);
    expect(chips[chips.length - 1].key).toBe(SURPRISE);
  });

  it("never offers a cuisine with nowhere to send you", () => {
    // A chip that can only return the fallback list is worse than no chip.
    const labels = buildCuisineChips(breakdown, []).map((c) => c.label);
    expect(labels).not.toContain("Steakhouse");
  });

  it("ignores the 'other' bucket and unclassified places", () => {
    expect(nearbyCuisines(pool)).not.toContain("other");
    expect(nearbyCuisines(pool)).toEqual(["steakhouse", "american", "thai"]);
  });
});

describe("moodContextNote", () => {
  it("says plainly that a cuisine is not your thing, and still shows them", () => {
    expect(moodContextNote("steakhouse", 20))
      .toBe("You have never gone in for Steakhouse. These are just the best ones near you.");
  });

  it("softens when there is a partial fit", () => {
    expect(moodContextNote("steakhouse", 50)).toMatch(/not really your pattern/);
  });

  it("stays quiet when the picks speak for themselves", () => {
    expect(moodContextNote("american", 80)).toBeNull();
  });

  it("says nothing for the intents, which are not about taste", () => {
    expect(moodContextNote(QUICK, 10)).toBeNull();
    expect(moodContextNote(SURPRISE, 10)).toBeNull();
    expect(moodContextNote(null, 10)).toBeNull();
  });
});
