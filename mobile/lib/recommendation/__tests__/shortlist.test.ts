import { founderGraph, poolAsInputs } from "./ranking-harness.test";
import { scoreRestaurant } from "../scoring";
import { shortlist, topShare, daySeed, fnv1a, mulberry32 } from "../shortlist";
import { isStretch } from "../candidates";
import { shareOf } from "../taste-graph";
import { foldFeedback, type FeedbackLedger } from "../feedback";
import type { TasteGraph } from "../taste-graph";
import type { RestaurantInput } from "../types";

const HERE = { lat: 35.098, lng: -89.841 };
const NOW = new Date(2026, 8, 8, 19, 30);
const DAY = 86_400_000;

type Row = { r: RestaurantInput; final: number; km: number };
function km(a: { lat: number; lng: number }, r: RestaurantInput): number {
  const R = 6371, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad((r.latitude ?? 0) - a.lat), dLng = toRad((r.longitude ?? 0) - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(r.latitude ?? 0)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function ranked(g: TasteGraph): Row[] {
  return poolAsInputs()
    .map((r) => ({ r, final: scoreRestaurant(g, r, { here: HERE, now: NOW, mode: "browsing" }).finalScore, km: km(HERE, r) }))
    .sort((a, b) => b.final - a.final);
}
function pick(g: TasteGraph, seed = "u:2026-09-08", explore = true) {
  return shortlist(ranked(g), { graph: g, now: NOW, seed, toInput: (t) => t.r, distanceKm: (t) => t.km, explore });
}

describe("the explore slot on the real pool", () => {
  it("fires for the founder, whose top cuisine is 46% of his visits", () => {
    expect(topShare(founderGraph().cuisineTypes)).toBeGreaterThanOrEqual(0.40);
    const s = pick(founderGraph());
    expect(s.picks).toHaveLength(3);
    expect(s.exploreIndex).toBe(2);
  });

  it("picks something outside the pattern that is still connected to it, open, near, and not disliked", () => {
    const g = founderGraph();
    const s = pick(g);
    const e = s.picks[2];
    // eslint-disable-next-line no-console
    console.log(`\nEXPLORE: ${e.r.name} (${e.r.cuisine_type}) final=${e.final} ${e.km.toFixed(1)}km` +
      `  beside ${s.picks[0].r.name} / ${s.picks[1].r.name}`);
    expect(isStretch(g, e.r)).toBe(true);
    // Outside the pattern: under 5% of his visits (one steakhouse in 35 counts).
    expect(shareOf(g.cuisineTypes, e.r.cuisine_type ?? "")).toBeLessThan(0.05);
    expect(e.km).toBeLessThanOrEqual(4);
    expect(e.r.cuisine_type).not.toBe(s.picks[0].r.cuisine_type);
    expect(e.r.cuisine_type).not.toBe(s.picks[1].r.cuisine_type);
  });

  it("holds still for the day and changes across days", () => {
    const g = founderGraph();
    const a = pick(g, "u:2026-09-08").picks[2].r.google_place_id;
    const b = pick(g, "u:2026-09-08").picks[2].r.google_place_id;
    expect(a).toBe(b);
    const seen = new Set<string>();
    for (let d = 1; d <= 30; d++) seen.add(pick(g, `u:2026-09-${String(d).padStart(2, "0")}`).picks[2].r.google_place_id);
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it("stays off while a mood chip is active, and when the graph is thin", () => {
    expect(pick(founderGraph(), "u:2026-09-08", false).exploreIndex).toBeNull();
    const thin: TasteGraph = { ...founderGraph(), dataDepth: "low" };
    const s = pick(thin);
    expect(s.exploreIndex).toBeNull();
    // ...and three rows are three cuisines while it is thin.
    const cuisines = new Set(s.picks.map((t) => t.r.cuisine_type));
    expect(cuisines.size).toBe(3);
  });

  it("never offers a place the person has been passing on, nor one seen this month", () => {
    const g = founderGraph();
    const first = pick(g).picks[2].r.google_place_id;
    const ledger: FeedbackLedger = new Map([[first, { untaken: 2, clicks: 0, maps: 0, skips: 0, save: 0, lastSeenAt: null }]]);
    expect(pick({ ...g, feedbackByPlace: ledger }).picks[2].r.google_place_id).not.toBe(first);
    const seen: FeedbackLedger = new Map([[first, { untaken: 0, clicks: 0, maps: 0, skips: 0, save: 0, lastSeenAt: NOW.getTime() - 3 * DAY }]]);
    expect(pick({ ...g, feedbackByPlace: seen }).picks[2].r.google_place_id).not.toBe(first);
  });

  it("does not collapse back into the pattern over thirty ignored days", () => {
    const g0 = founderGraph();
    const rows: Array<{ event: string; props: { google_place_id: string }; created_at: string }> = [];
    let nonAmericanExplore = 0, fired = 0, allOneCuisine = 0;
    for (let d = 0; d < 30; d++) {
      const now = new Date(NOW.getTime() + d * DAY);
      const g = { ...g0, feedbackByPlace: foldFeedback(rows, now.getTime()) };
      const s = shortlist(ranked(g), { graph: g, now, seed: daySeed("u", now), toInput: (t) => t.r, distanceKm: (t) => t.km });
      const cuisines = new Set(s.picks.map((t) => t.r.cuisine_type));
      if (cuisines.size === 1) allOneCuisine++;
      if (s.exploreIndex != null) { fired++; if (s.picks[2].r.cuisine_type !== "american") nonAmericanExplore++; }
      for (const t of s.picks) rows.push({ event: "rec_restaurant_viewed", props: { google_place_id: t.r.google_place_id }, created_at: now.toISOString() });
    }
    // The pool within 4km that is open, adjacent and unfamiliar is about a
    // dozen places; once each has had its day the slot waits for the month to
    // turn. Measured 2026-09-06: 11 of 30 days. Roughly one day in three is
    // the rate the design wanted, and a slot that sometimes has nothing new
    // to offer is better than one that repeats itself.
    // eslint-disable-next-line no-console
    console.log(`  explore fired ${fired}/30 days, non-American ${nonAmericanExplore}, days with one cuisine ${allOneCuisine}`);
    expect(allOneCuisine).toBe(0);
    expect(fired).toBeGreaterThanOrEqual(8);
    expect(nonAmericanExplore).toBe(fired);
  });
});

describe("seeding", () => {
  it("is deterministic and spreads", () => {
    const a = mulberry32(fnv1a("x")); const b = mulberry32(fnv1a("x"));
    expect(a()).toBe(b());
    const xs = Array.from({ length: 1000 }, (_, i) => mulberry32(fnv1a(`seed${i}`))());
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(xs.reduce((s, x) => s + x, 0) / xs.length).toBeCloseTo(0.5, 1);
  });
  it("names the day in local time", () => {
    expect(daySeed("u", new Date(2026, 8, 8, 23, 59))).toBe("u:2026-09-08");
    expect(daySeed(null, new Date(2026, 0, 1, 0, 0))).toBe("anon:2026-01-01");
  });
});
