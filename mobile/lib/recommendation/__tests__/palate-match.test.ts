import {
  computePalateMatch,
  matchHeadline,
  cosine,
  MATCH_MIN_VISITS,
} from "../palate-match";
import type { TasteVector } from "../../taste-vector";

function vec(p: Partial<TasteVector>): TasteVector {
  return {
    visitCount: 20,
    wishlistCount: 0,
    cuisineRegion: {},
    cuisineSubregion: {},
    cuisineRegionAspirational: {},
    cuisineSubregionAspirational: {},
    formatClass: {},
    priceTier: {},
    chainType: {},
    occasion: {},
    flavor: {},
    culturalContext: {},
    topNeighborhoods: [],
    neighborhoodLoyalty: 0,
    geographicSpreadKm: 0,
    ...p,
  } as TasteVector;
}

describe("cosine", () => {
  it("is 1 for identical maps and 0 when one is empty", () => {
    expect(cosine({ a: 1, b: 2 }, { a: 1, b: 2 })).toBeCloseTo(1);
    expect(cosine({}, { a: 1 })).toBe(0);
  });

  it("is 0 for disjoint palates", () => {
    expect(cosine({ italian: 1 }, { korean: 1 })).toBe(0);
  });
});

describe("computePalateMatch", () => {
  const twins = () =>
    vec({
      cuisineRegion: { american: 0.5, mexican: 0.3, italian: 0.2 },
      formatClass: { casual: 0.8, fine_dining: 0.2 },
      priceTier: { "2": 0.7, "3": 0.3 },
    });

  it("withholds a score until both people have real history", () => {
    const thin = vec({ visitCount: 2, cuisineRegion: { american: 1 } });
    const rich = twins();

    const r = computePalateMatch(rich, thin);
    expect(r.ready).toBe(false);
    if (!r.ready) {
      expect(r.threshold).toBe(MATCH_MIN_VISITS);
      expect(r.theirVisits).toBe(2);
    }
  });

  it("scores identical palates near the top but never claims 100", () => {
    const r = computePalateMatch(twins(), twins(), { sharedPlaceCount: 8, unionPlaceCount: 10 });
    expect(r.ready).toBe(true);
    if (r.ready) {
      expect(r.score).toBeGreaterThan(85);
      expect(r.score).toBeLessThanOrEqual(99);
    }
  });

  it("scores opposite palates low but never claims zero", () => {
    const a = vec({ cuisineRegion: { american: 1 }, formatClass: { fast_casual: 1 }, priceTier: { "1": 1 } });
    const b = vec({ cuisineRegion: { japanese: 1 }, formatClass: { fine_dining: 1 }, priceTier: { "4": 1 } });
    const r = computePalateMatch(a, b);
    expect(r.ready).toBe(true);
    if (r.ready) {
      expect(r.score).toBeGreaterThanOrEqual(20);
      expect(r.score).toBeLessThan(40);
    }
  });

  it("ranks a closer pair above a distant one", () => {
    const me = twins();
    const close = vec({
      cuisineRegion: { american: 0.45, mexican: 0.35, italian: 0.2 },
      formatClass: { casual: 0.7, fine_dining: 0.3 },
      priceTier: { "2": 0.6, "3": 0.4 },
    });
    const far = vec({ cuisineRegion: { korean: 0.9, thai: 0.1 }, formatClass: { fast_casual: 1 } });

    const a = computePalateMatch(me, close);
    const b = computePalateMatch(me, far);
    expect(a.ready && b.ready && a.score > b.score).toBe(true);
  });

  it("names what you share — the number alone convinces nobody", () => {
    const r = computePalateMatch(twins(), twins(), { sharedPlaceCount: 6, unionPlaceCount: 12 });
    expect(r.ready).toBe(true);
    if (r.ready) {
      expect(r.sharedCuisines).toContain("american");
      expect(r.reasons.map((x) => x.kind)).toContain("shared_cuisine");
      expect(r.reasons.find((x) => x.kind === "shared_places")?.label)
        .toBe("You've both been to 6 of the same places");
    }
  });

  it("names the axis where you split", () => {
    const a = vec({ cuisineRegion: { american: 0.8, mexican: 0.2 } });
    const b = vec({ cuisineRegion: { american: 0.2, mexican: 0.8 } });
    const r = computePalateMatch(a, b);
    expect(r.ready).toBe(true);
    if (r.ready) {
      expect(r.divergence).not.toBeNull();
      expect(r.reasons.some((x) => x.kind === "divergence")).toBe(true);
    }
  });

  it("does not credit shared places when there are none", () => {
    const r = computePalateMatch(twins(), twins(), { sharedPlaceCount: 0, unionPlaceCount: 10 });
    const both = computePalateMatch(twins(), twins(), { sharedPlaceCount: 10, unionPlaceCount: 10 });
    expect(r.ready && both.ready && both.score > r.score).toBe(true);
  });
});

describe("matchHeadline", () => {
  it("tells an unready pair what it needs, and whose it is", () => {
    // Was "4 more visits to unlock", which named nobody. Here the READER is
    // the one with a thin history, so it should say so.
    const r = computePalateMatch(vec({ visitCount: 1 }), vec({ visitCount: 20 }));
    expect(matchHeadline(r, "Marcus")).toBe("You need 4 more visits before this means anything");
  });

  it("is honest at the bottom of the range", () => {
    const a = vec({ cuisineRegion: { american: 1 } });
    const b = vec({ cuisineRegion: { japanese: 1 } });
    expect(matchHeadline(computePalateMatch(a, b), "Marcus")).toBe("Marcus eats nothing like you");
  });
});

// "4 more visits to unlock" read as a demand on the reader, who had 33 visits
// while the person they were looking at had one. A locked state has to say
// whose history is short or it accuses the wrong person.
describe("locked headline names who is short", () => {
  const locked = (yourVisits: number, theirVisits: number) =>
    matchHeadline({ ready: false, yourVisits, theirVisits, threshold: 5 } as never, "Candice");

  it("names them when it is their history that is thin", () => {
    expect(locked(33, 1)).toBe("Candice needs 4 more visits before this means anything");
  });

  it("names you when it is yours", () => {
    expect(locked(2, 40)).toBe("You need 3 more visits before this means anything");
  });

  it("says both when neither has enough", () => {
    expect(locked(1, 1)).toMatch(/You both/);
  });

  it("uses the singular for one visit", () => {
    expect(locked(33, 4)).toContain("1 more visit before");
  });

  it("never blames the reader for someone else's empty history", () => {
    expect(locked(33, 1)).not.toMatch(/^You /);
  });
});
