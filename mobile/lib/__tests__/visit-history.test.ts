import {
  repeatOrdinals, visitCounts, groupByDay, dayLabel, filterVisits, type VisitLike,
} from "../visit-history";

function v(id: string, iso: string, restaurantId: string, name = restaurantId): VisitLike {
  return { id, visited_at: iso, restaurant_id: restaurantId, restaurant: { name } };
}

describe("repeatOrdinals", () => {
  // Returning is Palate's core signal, so "your 3rd time here" has to mean that
  // and not "the 3rd row we drew".
  it("counts from the first visit regardless of input order", () => {
    const list = [
      v("c", "2026-09-03T19:00:00", "kfar"),
      v("a", "2026-09-01T19:00:00", "kfar"),
      v("b", "2026-09-02T19:00:00", "kfar"),
    ];
    const o = repeatOrdinals(list);
    expect(o.get("a")).toBe(1);
    expect(o.get("b")).toBe(2);
    expect(o.get("c")).toBe(3);
  });

  it("counts each restaurant separately", () => {
    const o = repeatOrdinals([
      v("a", "2026-09-01T12:00:00", "kfar"),
      v("b", "2026-09-01T19:00:00", "sampan"),
      v("c", "2026-09-02T12:00:00", "kfar"),
    ]);
    expect(o.get("b")).toBe(1);
    expect(o.get("c")).toBe(2);
  });
});

describe("visitCounts", () => {
  it("totals visits per restaurant", () => {
    const c = visitCounts([
      v("a", "2026-09-01T12:00:00", "kfar"),
      v("b", "2026-09-02T12:00:00", "kfar"),
      v("c", "2026-09-02T19:00:00", "sampan"),
    ]);
    expect(c.get("kfar")).toBe(2);
    expect(c.get("sampan")).toBe(1);
  });
});

describe("groupByDay", () => {
  const now = new Date("2026-09-03T21:00:00");

  it("puts newest days first and newest visits first inside a day", () => {
    const days = groupByDay([
      v("old", "2026-09-01T12:00:00", "a"),
      v("lunch", "2026-09-03T12:00:00", "b"),
      v("dinner", "2026-09-03T19:00:00", "c"),
    ], now);

    expect(days.map((d) => d.key)).toEqual(["2026-09-03", "2026-09-01"]);
    expect(days[0].visits.map((x) => x.id)).toEqual(["dinner", "lunch"]);
  });

  it("names today and yesterday rather than dating them", () => {
    expect(dayLabel(new Date("2026-09-03T08:00:00"), now)).toBe("Today");
    expect(dayLabel(new Date("2026-09-02T23:59:00"), now)).toBe("Yesterday");
    expect(dayLabel(new Date("2026-09-01T08:00:00"), now)).not.toMatch(/Today|Yesterday/);
  });

  it("groups by local day, so a late dinner stays on its own evening", () => {
    // 11:30pm belongs to that night, not to the next morning.
    const days = groupByDay([v("late", "2026-09-02T23:30:00", "a")], now);
    expect(days[0].label).toBe("Yesterday");
  });

  it("returns nothing for an empty history", () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe("filterVisits", () => {
  const list = [
    v("a", "2026-09-01T12:00:00", "kfar", "K'Far Cafe"),
    v("b", "2026-09-02T12:00:00", "sampan", "Sampan"),
  ];

  it("matches on name, case-insensitively", () => {
    expect(filterVisits(list, "Sampan").map((x) => x.id)).toEqual(["b"]);
    expect(filterVisits(list, "SAMPAN").map((x) => x.id)).toEqual(["b"]);
  });

  it("ignores punctuation nobody types", () => {
    // "K'Far Cafe" searched as "kfar" — the apostrophe is not on anyone's mind.
    expect(filterVisits(list, "kfar").map((x) => x.id)).toEqual(["a"]);
    expect(filterVisits(list, "k'far").map((x) => x.id)).toEqual(["a"]);
  });

  it("returns everything for an empty or whitespace query", () => {
    expect(filterVisits(list, "")).toHaveLength(2);
    expect(filterVisits(list, "   ")).toHaveLength(2);
  });

  it("returns nothing rather than everything when there is no match", () => {
    expect(filterVisits(list, "zzz")).toHaveLength(0);
  });
});
