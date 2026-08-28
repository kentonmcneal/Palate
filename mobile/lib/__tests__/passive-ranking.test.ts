import { rankCandidates, mealWindow, RANK_WEIGHTS } from "../passive-pipeline";
import type { Restaurant } from "../places";

// Roughly 1e-4 degrees of latitude ~= 11m, which keeps these fixtures readable.
const HERE = { lat: 33.749, lng: -84.388 };

function place(partial: Partial<Restaurant> & { google_place_id: string }): Restaurant {
  return {
    name: partial.google_place_id,
    latitude: HERE.lat,
    longitude: HERE.lng,
    ...partial,
  } as Restaurant;
}

function at(metresNorth: number, partial: Partial<Restaurant> & { google_place_id: string }) {
  return place({ ...partial, latitude: HERE.lat + metresNorth / 111_000, longitude: HERE.lng });
}

describe("mealWindow", () => {
  it("buckets the day", () => {
    expect(mealWindow(8)).toBe("breakfast");
    expect(mealWindow(12)).toBe("lunch");
    expect(mealWindow(19)).toBe("dinner");
    expect(mealWindow(3)).toBe("off");
  });
});

describe("rankCandidates", () => {
  it("prefers the nearer place when nothing else distinguishes them", () => {
    const out = rankCandidates(HERE, [at(80, { google_place_id: "far" }), at(10, { google_place_id: "near" })], { hour: 12 });
    expect(out[0].google_place_id).toBe("near");
  });

  it("promotes a place the user has visited before over a slightly nearer one", () => {
    // The core insight: people return to places. A 30m gap should not beat a
    // known favourite.
    const out = rankCandidates(
      HERE,
      [at(10, { google_place_id: "stranger" }), at(40, { google_place_id: "regular" })],
      { hour: 12, visitedPlaceIds: new Set(["regular"]) },
    );
    expect(out[0].google_place_id).toBe("regular");
  });

  it("does not let the visited bonus override a much larger distance gap", () => {
    // Distance is the only direct evidence; priors must not steamroll it.
    const out = rankCandidates(
      HERE,
      [at(5, { google_place_id: "next-door" }), at(200, { google_place_id: "regular-far" })],
      { hour: 12, visitedPlaceIds: new Set(["regular-far"]) },
    );
    expect(out[0].google_place_id).toBe("next-door");
  });

  it("breaks a distance tie toward the busier venue", () => {
    const out = rankCandidates(
      HERE,
      [
        at(20, { google_place_id: "quiet", user_rating_count: 3 }),
        at(20, { google_place_id: "busy", user_rating_count: 5000 }),
      ],
      { hour: 12 },
    );
    expect(out[0].google_place_id).toBe("busy");
  });

  it("prefers a bakery at breakfast and a bar at dinner, same geometry", () => {
    const candidates = [
      at(20, { google_place_id: "bakery", primary_type: "bakery" }),
      at(20, { google_place_id: "bar", primary_type: "bar" }),
    ];
    expect(rankCandidates(HERE, candidates, { hour: 8 })[0].google_place_id).toBe("bakery");
    expect(rankCandidates(HERE, candidates, { hour: 19 })[0].google_place_id).toBe("bar");
  });

  it("caps popularity so a chain cannot dominate on reviews alone", () => {
    const boostCeiling = RANK_WEIGHTS.popularityMax;
    const out = rankCandidates(
      HERE,
      [
        at(0, { google_place_id: "adjacent", user_rating_count: 1 }),
        at(boostCeiling + 30, { google_place_id: "megachain", user_rating_count: 10_000_000 }),
      ],
      { hour: 12 },
    );
    expect(out[0].google_place_id).toBe("adjacent");
  });

  it("returns at most three candidates", () => {
    const many = Array.from({ length: 8 }, (_, i) => at(i * 5, { google_place_id: `p${i}` }));
    expect(rankCandidates(HERE, many, { hour: 12 })).toHaveLength(3);
  });

  it("handles places with no coordinates without throwing", () => {
    const out = rankCandidates(
      HERE,
      [place({ google_place_id: "nocoords", latitude: null, longitude: null }), at(10, { google_place_id: "known" })],
      { hour: 12 },
    );
    expect(out[0].google_place_id).toBe("known");
  });
});
