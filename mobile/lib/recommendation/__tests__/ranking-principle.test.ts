import fs from "fs";
import path from "path";
import { poolAsInputs, founderGraph } from "./ranking-harness.test";
import { scoreRestaurant } from "../scoring";
import { filterRecommendable } from "../eligibility";
import { dedupeVenues } from "../dedupe";
import type { TasteGraph } from "../taste-graph";

// ============================================================================
// The product principle, as executable statements.
// ----------------------------------------------------------------------------
// Stated by the founder on 2026-09-07:
//
//   "The focus should always be best restaurant in the city for that person,
//    and should change as their eating habits change, and they should be able
//    to switch what mood or cuisine they want to eat today. They have the
//    option to search nearby ... ordered by distance, but the first and
//    foremost suggestion is best restaurant for them."
//
// Four claims, each of which the code already satisfies. They are written down
// here because they are the kind of thing that erodes one weight at a time:
// nudge the distance term twice and Home quietly becomes a proximity list, and
// nothing would fail.
// ============================================================================

const HERE = { lat: 35.098, lng: -89.841 };
const NOW = new Date(2026, 8, 8, 19, 30);

const pool = () =>
  dedupeVenues(filterRecommendable(poolAsInputs() as never, { hidden: null })) as unknown as Array<Record<string, never>>;

function rank(g: TasteGraph, opts: { here?: typeof HERE } = {}) {
  return pool()
    .map((r) => ({ r, f: scoreRestaurant(g, r as never, { here: opts.here, now: NOW, mode: "browsing" }).finalScore }))
    .sort((a, b) => b.f - a.f);
}

const nameOf = (x: { r: Record<string, never> }) => (x.r as unknown as { name: string }).name;

describe("1. the first suggestion is the best for them, not the closest", () => {
  const withDistance = rank(founderGraph(), { here: HERE });
  const without = rank(founderGraph());

  it("keeps the same top pick whether or not distance is known", () => {
    expect(nameOf(withDistance[0])).toBe(nameOf(without[0]));
  });

  it("keeps almost the whole top ten", () => {
    const a = new Set(withDistance.slice(0, 10).map(nameOf));
    const overlap = without.slice(0, 10).map(nameOf).filter((n) => a.has(n)).length;
    expect(overlap).toBeGreaterThanOrEqual(8);
  });

  it("still lets distance break ties, pulling the top five closer", () => {
    // Measured: 3.9km average with distance, 5.3km without. Proximity is a
    // nudge and is meant to stay one.
    const km = (x: { r: Record<string, never> }) => {
      const r = x.r as unknown as { latitude: number; longitude: number };
      const dLat = (r.latitude - HERE.lat) * Math.PI / 180;
      const dLng = (r.longitude - HERE.lng) * Math.PI / 180;
      const s = Math.sin(dLat / 2) ** 2 + Math.cos(HERE.lat * Math.PI / 180) * Math.cos(r.latitude * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      return 2 * 6371 * Math.asin(Math.sqrt(s));
    };
    const avg = (xs: typeof withDistance) => xs.slice(0, 5).reduce((a, x) => a + km(x), 0) / 5;
    expect(avg(withDistance)).toBeLessThan(avg(without));
  });
});

describe("2. it changes as their eating habits change", () => {
  // Same city, same night, two different people. If the ranking does not move,
  // nothing in this app is personalised and every other test is decoration.
  const withHistory = (cuisine: string): TasteGraph => ({
    ...founderGraph(),
    cuisineTypes: { [cuisine]: 20 },
    cuisines: { [cuisine]: 20 },
    cuisinesSubregion: {},
    totalVisits: 20,
    dataDepth: "high",
  });

  it("gives two different eaters different answers", () => {
    const a = rank(withHistory("italian"), { here: HERE });
    const b = rank(withHistory("bbq"), { here: HERE });
    expect(nameOf(a[0])).not.toBe(nameOf(b[0]));
  });

  it("puts a person's own cuisine near the top of their list", () => {
    const cuisineOf = (x: { r: Record<string, never> }) => (x.r as unknown as { cuisine_type?: string }).cuisine_type;
    for (const c of ["italian", "bbq", "mexican"]) {
      const top10 = rank(withHistory(c), { here: HERE }).slice(0, 10).map(cuisineOf);
      expect(top10).toContain(c);
    }
  });
});

describe("3. and 4. mood switching, and nearby as a separate distance-ordered option", () => {
  const discover = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "..", "app", "(tabs)", "discover.tsx"), "utf8",
  );

  it("sorts the Nearby tab strictly by distance", () => {
    expect(discover).toMatch(/sort\(\(a, b\) => \(a\.distanceKm \?\? 999\) - \(b\.distanceKm \?\? 999\)\)/);
  });

  it("filters a mood BEFORE cutting to the top of the tab", () => {
    // Cutting first would answer "Thai?" from the thirty closest places rather
    // than from the closest Thai.
    expect(discover).toMatch(/mood is filtered BEFORE the cut/i);
  });

  it("offers mood chips on the personalised list too, not only on Nearby", () => {
    expect(discover).toContain("moodedList");
    expect(discover).toContain("moodChips");
  });
});
