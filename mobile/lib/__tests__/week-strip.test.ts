import { weekStrip, weekStripCopy } from "../week-strip";

describe("week strip", () => {
  const thu = new Date("2026-09-10T12:00:00"); // Thursday
  it("counts the week and names a day only when one stood out", () => {
    const w = weekStrip([
      { visited_at: "2026-09-08T12:00:00", restaurant_id: "a" },
      { visited_at: "2026-09-08T19:00:00", restaurant_id: "b" },
      { visited_at: "2026-09-09T12:00:00", restaurant_id: "a" },
      { visited_at: "2026-09-04T12:00:00", restaurant_id: "z" }, // last week
    ], thu);
    expect(w).toEqual({ visits: 3, places: 2, busiest: "Tuesday" });
    expect(weekStripCopy(w)).toBe("This week: 3 visits, 2 places. Tuesday was the big one.");
  });
  it("says nothing on an empty week, and no day when nothing stood out", () => {
    expect(weekStripCopy(weekStrip([], thu))).toBeNull();
    const w = weekStrip([{ visited_at: "2026-09-08T12:00:00", restaurant_id: "a" }], thu);
    expect(w.busiest).toBeNull();
    expect(weekStripCopy(w)).toBe("This week: 1 visit, 1 place.");
  });
});
