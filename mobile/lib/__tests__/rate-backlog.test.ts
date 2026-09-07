import { toUnrated, whenLabel, backlogLine } from "../rate-backlog";

// ============================================================================
// The backlog card exists because 53 of 55 visits were unrated, so the two
// things worth guarding are the ones that would silently produce a useless
// card: an embed shape that yields no restaurant name, and a date phrase that
// cannot help somebody remember the meal.
// ============================================================================

describe("toUnrated", () => {
  const base = { id: "v1", visited_at: "2026-03-04T19:00:00Z", restaurant_id: "r1" };

  it("reads the embed whether PostgREST returns an object or a one-element array", () => {
    const asObject = toUnrated({ ...base, restaurant: { name: "Acre", cuisine_type: "american", google_place_id: "g1" } });
    const asArray = toUnrated({ ...base, restaurant: [{ name: "Acre", cuisine_type: "american", google_place_id: "g1" }] });
    expect(asObject).toEqual(asArray);
    expect(asObject?.name).toBe("Acre");
    expect(asObject?.googlePlaceId).toBe("g1");
  });

  it("drops a visit with no restaurant name rather than asking 'how was ?'", () => {
    expect(toUnrated({ ...base, restaurant: null })).toBeNull();
    expect(toUnrated({ ...base, restaurant: { name: "   " } })).toBeNull();
    expect(toUnrated({ restaurant: { name: "Acre" } })).toBeNull();
  });

  it("keeps a missing cuisine as null rather than inventing one", () => {
    expect(toUnrated({ ...base, restaurant: { name: "Acre" } })?.cuisine).toBeNull();
  });
});

describe("whenLabel", () => {
  const now = new Date(2026, 8, 7, 12, 0); // 7 Sep 2026

  it("says it the way a person would", () => {
    expect(whenLabel(new Date(2026, 8, 7, 9).toISOString(), now)).toBe("today");
    expect(whenLabel(new Date(2026, 8, 6, 21).toISOString(), now)).toBe("yesterday");
    expect(whenLabel(new Date(2026, 8, 4, 19).toISOString(), now)).toBe("3 days ago");
    expect(whenLabel(new Date(2026, 7, 30, 19).toISOString(), now)).toBe("last week");
  });

  it("switches to a month once a day count stops being memorable", () => {
    expect(whenLabel(new Date(2026, 2, 4, 19).toISOString(), now)).toBe("in March");
  });

  it("names the year only when it is not this one", () => {
    expect(whenLabel(new Date(2025, 10, 4, 19).toISOString(), now)).toBe("in November 2025");
  });

  it("returns empty rather than NaN for an unparseable date", () => {
    expect(whenLabel("not a date", now)).toBe("");
  });
});

describe("backlogLine", () => {
  it("never shows a number to clear — a favour is not a debt", () => {
    const line = backlogLine(12);
    expect(line).not.toMatch(/\d/);
  });

  it("says nothing at all when this is the last one", () => {
    expect(backlogLine(1)).toBeNull();
    expect(backlogLine(0)).toBeNull();
  });
});
