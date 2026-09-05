import { ordinalLabel, youveBeenLabel, mealLine, dayHeader, groupFeedByDay, weekSummary } from "../feed-card";

describe("feed card copy", () => {
  it("ordinals read as stats", () => {
    expect(ordinalLabel(1)).toBe("First time");
    expect(ordinalLabel(2)).toBe("2nd visit");
    expect(ordinalLabel(3)).toBe("3rd visit");
    expect(ordinalLabel(11)).toBe("11th visit");
    expect(ordinalLabel(22)).toBe("22nd visit");
    expect(ordinalLabel(null)).toBeNull();
  });

  it("the reader's relationship to the place", () => {
    expect(youveBeenLabel(0, false)).toBe("Never been");
    expect(youveBeenLabel(1, false)).toBe("You've been once");
    expect(youveBeenLabel(4, false)).toBe("You've been 4 times");
    expect(youveBeenLabel(4, true)).toBeNull();
    expect(youveBeenLabel(null, false)).toBeNull();
  });

  it("meal line survives unknown meals and bad dates", () => {
    expect(mealLine("dinner", "2026-09-03T19:40:00")).toMatch(/^Dinner · \w{3} /);
    expect(mealLine("unknown", "2026-09-03T19:40:00")).toMatch(/^\w{3} /);
    expect(mealLine("dinner", null)).toBeNull();
    expect(mealLine("dinner", "nope")).toBeNull();
  });

  it("day headers like the old Following tab", () => {
    const now = new Date("2026-09-05T12:00:00");
    expect(dayHeader("2026-09-05T08:00:00", now)).toBe("Today");
    expect(dayHeader("2026-09-04T23:00:00", now)).toBe("Yesterday");
    expect(dayHeader("2026-09-02T12:00:00", now)).toBe("Wednesday");
    expect(dayHeader("2026-08-20T12:00:00", now)).toBe("August 20");
  });

  it("groups consecutive events under one header", () => {
    const now = new Date("2026-09-05T12:00:00");
    const g = groupFeedByDay([
      { created_at: "2026-09-05T10:00:00" },
      { created_at: "2026-09-05T09:00:00" },
      { created_at: "2026-09-04T09:00:00" },
    ], now);
    expect(g.map((s) => [s.title, s.data.length])).toEqual([["Today", 2], ["Yesterday", 1]]);
  });

  it("summarises the week from what is loaded", () => {
    const now = new Date("2026-09-05T12:00:00");
    const s = weekSummary([
      { id: "1", kind: "visit_logged", created_at: "2026-09-05T10:00:00", user_id: "a", restaurant: { google_place_id: "x" } },
      { id: "2", kind: "visit_logged", created_at: "2026-09-04T10:00:00", user_id: "b", restaurant: { google_place_id: "x" } },
      { id: "3", kind: "wrapped_shared", created_at: "2026-09-04T10:00:00", user_id: "a" },
      { id: "4", kind: "visit_logged", created_at: "2026-08-01T10:00:00", user_id: "a", restaurant: { google_place_id: "y" } },
    ], now);
    expect(s).toBe("This week: 2 visits, 2 people, 1 place.");
    expect(weekSummary([], now)).toBeNull();
  });
});
