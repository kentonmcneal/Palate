import { dedupeVenues } from "../dedupe";

const BASE = { latitude: 37.7749, longitude: -122.4194 };
// ~40m east of BASE — inside one building.
const NEXT_DOOR = { latitude: 37.7749, longitude: -122.41895 };
// ~1.3km away — a different branch of the same-named restaurant.
const ACROSS_TOWN = { latitude: 37.7749, longitude: -122.4044 };

function v(p: Partial<Parameters<typeof dedupeVenues>[0][number]> = {}) {
  return {
    google_place_id: "a",
    name: "Hong Kong Restaurant",
    ...BASE,
    rating: 4.2,
    user_rating_count: 100,
    ...p,
  };
}

describe("dedupeVenues", () => {
  it("collapses the keyword-stuffed twin Google returns for one venue", () => {
    // The reported case: both listings render, both are real place ids.
    const out = dedupeVenues([
      v({ google_place_id: "a", name: "Hong Kong Restaurant", user_rating_count: 480 }),
      v({ google_place_id: "b", name: "Hong Kong Restaurant | Chinese", user_rating_count: 12, ...NEXT_DOOR }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].google_place_id).toBe("a");
  });

  it("keeps the listing people actually review, not whichever came first", () => {
    const out = dedupeVenues([
      v({ google_place_id: "thin", name: "Gordo's Mexican Bar and Grill", user_rating_count: 3 }),
      v({ google_place_id: "rich", name: "Gordo's Mexican Bar and Grill & Mariscos", user_rating_count: 900, ...NEXT_DOOR }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].google_place_id).toBe("rich");
  });

  it("keeps two branches of the same name that are genuinely far apart", () => {
    const out = dedupeVenues([
      v({ google_place_id: "north", name: "Pho Saigon" }),
      v({ google_place_id: "south", name: "Pho Saigon", ...ACROSS_TOWN }),
    ]);
    expect(out.map((x) => x.google_place_id)).toEqual(["north", "south"]);
  });

  it("does not merge different restaurants that share one leading word", () => {
    const out = dedupeVenues([
      v({ google_place_id: "a", name: "Thai" }),
      v({ google_place_id: "b", name: "Thai Basil Kitchen", ...NEXT_DOOR }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("collapses exact place-id repeats", () => {
    const out = dedupeVenues([v({ google_place_id: "a" }), v({ google_place_id: "a" })]);
    expect(out).toHaveLength(1);
  });

  it("requires identical names when coordinates are missing", () => {
    const out = dedupeVenues([
      v({ google_place_id: "a", name: "Hong Kong Restaurant", latitude: null, longitude: null }),
      v({ google_place_id: "b", name: "Hong Kong Restaurant | Chinese", latitude: null, longitude: null }),
      v({ google_place_id: "c", name: "Hong Kong Restaurant", latitude: null, longitude: null }),
    ]);
    expect(out.map((x) => x.google_place_id)).toEqual(["a", "b"]);
  });

  it("preserves order and the caller's row type", () => {
    const rows = [
      { ...v({ google_place_id: "a", name: "Alpha" }), note: "keep-me" },
      { ...v({ google_place_id: "b", name: "Beta" }) },
    ];
    const out = dedupeVenues(rows);
    expect(out.map((x) => x.google_place_id)).toEqual(["a", "b"]);
    expect((out[0] as { note?: string }).note).toBe("keep-me");
  });

  it("leaves a clean list untouched", () => {
    const rows = [v({ google_place_id: "a", name: "Alpha" }), v({ google_place_id: "b", name: "Beta" })];
    expect(dedupeVenues(rows)).toHaveLength(2);
  });
});
