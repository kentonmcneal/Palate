import { repeatRate, allTimeStats, weekIsWorthShowing } from "../wrapped-scope";

// Returning is the signal Palate is built on, so the repeat number is the one
// on the card that carries the thesis. It has to mean what it says.
describe("repeatRate", () => {
  it("is zero when every visit was somewhere new", () => {
    expect(repeatRate(10, 10)).toBe(0);
  });

  it("counts everything past the first visit to a place as a return", () => {
    // 10 visits across 3 places: 3 firsts, 7 returns.
    expect(repeatRate(10, 3)).toBeCloseTo(0.7);
  });

  it("is zero for an empty history rather than dividing by nothing", () => {
    expect(repeatRate(0, 0)).toBe(0);
  });

  it("never goes negative on inconsistent inputs", () => {
    // More distinct places than visits is impossible, but a bad aggregate
    // should produce 0 rather than a negative percentage on the card.
    expect(repeatRate(3, 10)).toBe(0);
  });
});

describe("allTimeStats", () => {
  const summary = {
    totalVisits: 30,
    uniqueRestaurants: 18,
    topSpots: [
      { name: "K'Far Cafe", count: 4 },
      { name: "Chick-fil-A", count: 3 },
      { name: "Sampan", count: 2 },
      { name: "ANINA", count: 1 },
    ],
  } as never;

  it("leads with the accumulated history, not a week", () => {
    const s = allTimeStats(summary);
    expect(s.totalVisits).toBe(30);
    expect(s.uniqueRestaurants).toBe(18);
    expect(s.rangeLabel).toBe("All time");
  });

  it("takes only the top three spots", () => {
    expect(allTimeStats(summary).topThree.map((t) => t.name))
      .toEqual(["K'Far Cafe", "Chick-fil-A", "Sampan"]);
  });

  it("derives the repeat rate from the same two numbers it displays", () => {
    // 30 visits, 18 places -> 12 returns.
    expect(allTimeStats(summary).repeatRate).toBeCloseTo(12 / 30);
  });
});

describe("weekIsWorthShowing", () => {
  it("hides the week section when nothing was logged", () => {
    // A section reading "0 visits" is worse than no section.
    expect(weekIsWorthShowing(0)).toBe(false);
    expect(weekIsWorthShowing(null)).toBe(false);
  });

  it("shows it for even one meal", () => {
    expect(weekIsWorthShowing(1)).toBe(true);
  });
});
