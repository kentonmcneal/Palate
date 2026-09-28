import { assembleGraph, emptyVector } from "../taste-graph";
import { computeCompatibility } from "../compatibility";
import { founderGraph, poolAsInputs } from "./ranking-harness.test";
import type { TasteGraph } from "../taste-graph";

// ============================================================================
// Three visits should lean, not build a wall.
// ============================================================================

const base = { name: "X", format_class: "casual_dining", price_level: 2, rating: 4.4, user_rating_count: 300 };

function graphWith(visits: number, region: string, sub: string): TasteGraph {
  const v = emptyVector();
  v.visitCount = visits;
  v.cuisineRegion = { [region]: visits };
  v.cuisineSubregion = { [sub]: visits };
  return assembleGraph(v, null);
}

describe("cold start shrinkage", () => {
  it("at three visits a mismatch is a lean, not a floor, and the order still holds", () => {
    const g = graphWith(3, "italian", "italian_trattoria");
    const good = computeCompatibility(g, { ...base, google_place_id: "a", cuisine_region: "italian", cuisine_subregion: "italian_trattoria" }).score;
    const bad = computeCompatibility(g, { ...base, google_place_id: "b", cuisine_region: "east_asian", cuisine_subregion: "thai" }).score;
    const unknown = computeCompatibility(g, { ...base, google_place_id: "c", cuisine_region: null, cuisine_subregion: null }).score;
    // eslint-disable-next-line no-console
    console.log(`\n3 VISITS: good ${good}  unknown ${unknown}  poor ${bad}`);
    expect(good).toBeGreaterThan(unknown);
    expect(unknown).toBeGreaterThanOrEqual(bad);
    expect(bad).toBeGreaterThanOrEqual(30);
  });

  it("the lean sharpens with evidence", () => {
    const at = (n: number) => {
      const g = graphWith(n, "italian", "italian_trattoria");
      const good = computeCompatibility(g, { ...base, google_place_id: "a", cuisine_region: "italian", cuisine_subregion: "italian_trattoria" }).score;
      const bad = computeCompatibility(g, { ...base, google_place_id: "b", cuisine_region: "east_asian", cuisine_subregion: "thai" }).score;
      return good - bad;
    };
    expect(at(3)).toBeLessThan(at(10));
    expect(at(10)).toBeLessThan(at(35));
  });

  it("barely moves the founder: good on top, and never-eaten still under unclassified", () => {
    const g = founderGraph();
    const all = poolAsInputs().map((r) => ({ r, score: computeCompatibility(g, r).score }));
    const good = all.filter((t) => t.r.cuisine_type === "american");
    const unknown = all.filter((t) => !t.r.cuisine_type && !t.r.cuisine_region && !t.r.cuisine_subregion);
    const poor = all.filter((t) => t.r.cuisine_type && !["american", "steakhouse", "middle-eastern"].includes(t.r.cuisine_type));
    // "Not his top three" is NOT the same as "a poor fit": 72 of those 106 rows
    // are cuisines he has actually eaten (italian, chinese, japanese, mexican,
    // mediterranean, filipino). The bucket only looked poor while never-eaten
    // scored 0.0625 and dragged the whole average down with it.
    const eaten = new Set(Object.keys(g.cuisineTypes).filter((k) => g.cuisineTypes[k] > 0));
    const neverEaten = poor.filter((t) => !eaten.has(t.r.cuisine_type!));
    const avg = (xs: typeof all) => xs.reduce((s, t) => s + t.score, 0) / Math.max(1, xs.length);
    // eslint-disable-next-line no-console
    console.log(`  founder: good ${avg(good).toFixed(1)}  unclassified ${avg(unknown).toFixed(1)}  never-eaten ${avg(neverEaten).toFixed(1)}  bucket ${avg(poor).toFixed(1)}`);
    expect(avg(good)).toBeGreaterThan(80);
    // Replaces `avg(poor) < 52`, which was a snapshot of the defect rather than
    // an invariant: it could only hold while cuisines he HAS eaten were being
    // punished for a held-out visit. 47.3 -> 56.8 is the fix working. The
    // property actually worth defending is the unconfounded one below, and the
    // controlled paired version in ranking-harness.test.ts is stronger still.
    expect(avg(neverEaten)).toBeLessThan(avg(unknown));
  });
});
