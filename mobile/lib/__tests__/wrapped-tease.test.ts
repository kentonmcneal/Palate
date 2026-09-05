import { weekSoFar, teaseCopy, teaseTimeFor } from "../wrapped-tease";

describe("wrapped tease", () => {
  const wed = new Date("2026-09-09T12:00:00"); // Wednesday

  it("counts only this ISO week", () => {
    const w = weekSoFar([
      { visited_at: "2026-09-08T19:00:00", restaurant_id: "a" },
      { visited_at: "2026-09-09T08:00:00", restaurant_id: "a" },
      { visited_at: "2026-09-05T19:00:00", restaurant_id: "b" }, // last week
    ], wed);
    expect(w).toEqual({ visits: 2, places: 1 });
  });

  it("says nothing when there is nothing to say", () => {
    expect(teaseCopy({ visits: 0, places: 0 })).toBeNull();
  });

  it("puts the numbers in the copy", () => {
    expect(teaseCopy({ visits: 4, places: 3 })?.body).toBe("4 visits, 3 places. Wrapped reads it back tomorrow.");
    expect(teaseCopy({ visits: 1, places: 1 })?.body).toBe("1 visit, 1 place. Wrapped reads it back tomorrow.");
  });

  it("fires Saturday at 18:30 and not after it has passed", () => {
    const t = teaseTimeFor(wed);
    expect(t?.getDay()).toBe(6);
    expect(t?.getHours()).toBe(18);
    expect(t?.getMinutes()).toBe(30);
    const satNight = new Date("2026-09-12T20:00:00");
    expect(teaseTimeFor(satNight)).toBeNull();
  });
});
