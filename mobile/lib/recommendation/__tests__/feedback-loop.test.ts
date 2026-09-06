import { founderGraph, poolAsInputs } from "./ranking-harness.test";
import { scoreRestaurant } from "../scoring";
import { computeCompatibility } from "../compatibility";
import { capByKey } from "../reranking";
import { foldFeedback, isResting, type FeedbackLedger, type PlaceFeedback } from "../feedback";
import type { TasteGraph } from "../taste-graph";
import type { RestaurantInput } from "../types";

// ============================================================================
// The loop against the real pool: does the list rotate, does it stay sane,
// and can implicit feedback ever reach a place it was not about.
// ============================================================================

const HERE = { lat: 35.098, lng: -89.841 };
const NOW = new Date(2026, 8, 8, 19, 30);
const DAY = 86_400_000;

function withLedger(ledger: FeedbackLedger): TasteGraph {
  return { ...founderGraph(), feedbackByPlace: ledger };
}
function fb(partial: Partial<PlaceFeedback>): PlaceFeedback {
  return { untaken: 0, clicks: 0, maps: 0, skips: 0, save: 0, lastSeenAt: null, ...partial };
}
function rankedBy(g: TasteGraph, pool = poolAsInputs()) {
  return pool
    .map((r) => ({ r, final: scoreRestaurant(g, r, { here: HERE, now: NOW, mode: "browsing" }).finalScore }))
    .sort((a, b) => b.final - a.final);
}
function shortlist(g: TasteGraph) {
  const ranked = rankedBy(g);
  const fresh = ranked.filter((t) => !isResting(g.feedbackByPlace, t.r.google_place_id));
  return capByKey(fresh.length >= 3 ? fresh : ranked, (t) => t.r.cuisine_type, 2, 3).map((t) => t.r.google_place_id);
}

describe("non-generalisation: implicit feedback never leaves its place", () => {
  it("passes on every American place but one leave that one's finalScore exactly unchanged", () => {
    const pool = poolAsInputs();
    const american = pool.filter((r) => r.cuisine_type === "american");
    expect(american.length).toBeGreaterThan(10);
    const heldOut = american[0];
    const ledger: FeedbackLedger = new Map();
    for (const r of american.slice(1)) ledger.set(r.google_place_id, fb({ untaken: 3 }));

    const before = scoreRestaurant(founderGraph(), heldOut, { here: HERE, now: NOW, mode: "browsing" }).finalScore;
    const after = scoreRestaurant(withLedger(ledger), heldOut, { here: HERE, now: NOW, mode: "browsing" }).finalScore;
    expect(after).toBe(before);
  });

  it("clicks and directions on every Italian place but one leave that one exactly unchanged", () => {
    const pool = poolAsInputs();
    const italian = pool.filter((r) => r.cuisine_type === "italian");
    expect(italian.length).toBeGreaterThan(2);
    const heldOut = italian[0];
    const ledger: FeedbackLedger = new Map();
    for (const r of italian.slice(1)) ledger.set(r.google_place_id, fb({ clicks: 2, maps: 1 }));
    const before = scoreRestaurant(founderGraph(), heldOut, { here: HERE, now: NOW, mode: "browsing" }).finalScore;
    const after = scoreRestaurant(withLedger(ledger), heldOut, { here: HERE, now: NOW, mode: "browsing" }).finalScore;
    expect(after).toBe(before);
  });

  it("does not move the displayed % match at all", () => {
    const pool = poolAsInputs();
    const ledger: FeedbackLedger = new Map();
    for (const r of pool) ledger.set(r.google_place_id, fb({ untaken: 3, skips: 2 }));
    const g = withLedger(ledger);
    for (const r of pool.slice(0, 50)) {
      expect(computeCompatibility(g, r).score).toBe(computeCompatibility(founderGraph(), r).score);
    }
  });
});

describe("rotation", () => {
  it("today's three, passed over once, gives tomorrow at least one new place and keeps at least one", () => {
    const today = shortlist(founderGraph());
    const ledger: FeedbackLedger = new Map(today.map((id) => [id, fb({ untaken: 1 })]));
    const tomorrow = shortlist(withLedger(ledger));
    const kept = tomorrow.filter((id) => today.includes(id));
    const fresh = tomorrow.filter((id) => !today.includes(id));
    // eslint-disable-next-line no-console
    console.log(`\nROTATION after one pass: kept ${kept.length}, new ${fresh.length}`);
    expect(fresh.length).toBeGreaterThanOrEqual(1);
    expect(kept.length).toBeGreaterThanOrEqual(1);
  });

  it("three ignored days rest all three", () => {
    const today = shortlist(founderGraph());
    const ledger: FeedbackLedger = new Map(today.map((id) => [id, fb({ untaken: 3 })]));
    const later = shortlist(withLedger(ledger));
    expect(later.filter((id) => today.includes(id))).toHaveLength(0);
  });

  it("never pushes a passed-over #1 out of the top thirty", () => {
    const top = shortlist(founderGraph())[0];
    const ledger: FeedbackLedger = new Map([[top, fb({ untaken: 4, skips: 2 })]]);
    const rank = rankedBy(withLedger(ledger)).findIndex((t) => t.r.google_place_id === top) + 1;
    // eslint-disable-next-line no-console
    console.log(`  #1 after the maximum penalty sits at rank ${rank}`);
    expect(rank).toBeGreaterThan(1);
    expect(rank).toBeLessThanOrEqual(30);
  });

  it("brings an original back once the passes have decayed for four weeks", () => {
    const today = shortlist(founderGraph());
    const ledger: FeedbackLedger = new Map(today.map((id) => [id, fb({ untaken: 4 * 0.25 })]));
    const later = shortlist(withLedger(ledger));
    expect(later.filter((id) => today.includes(id)).length).toBeGreaterThanOrEqual(1);
  });

  it("a fresh save is visible the same evening", () => {
    // The best Italian place — his second cuisine, never in the three today.
    const ranked = rankedBy(founderGraph());
    const italian = ranked.find((t) => t.r.cuisine_type === "italian")!;
    expect(shortlist(founderGraph())).not.toContain(italian.r.google_place_id);
    const before = ranked.findIndex((t) => t.r === italian.r) + 1;
    const ledger: FeedbackLedger = new Map([[italian.r.google_place_id, fb({ save: 1, clicks: 1 })]]);
    const after = rankedBy(withLedger(ledger)).findIndex((t) => t.r.google_place_id === italian.r.google_place_id) + 1;
    // eslint-disable-next-line no-console
    console.log(`  best Italian: rank ${before} -> ${after} after a save and a look`);
    expect(after).toBeLessThan(before);
  });
});

describe("thirty days of being ignored", () => {
  it("shows at least twenty distinct places and four cuisines, and no one place more than twelve days", () => {
    // Simulate: each day the three shown and not taken become one more pass,
    // decaying at the real half-life, folded through the real fold.
    const rows: Array<{ event: string; props: { google_place_id: string }; created_at: string }> = [];
    const shownDays = new Map<string, number>();
    const cuisines = new Set<string>();
    const pool = poolAsInputs();
    const cuisineOf = new Map(pool.map((r) => [r.google_place_id, r.cuisine_type ?? ""]));
    for (let d = 0; d < 30; d++) {
      const now = NOW.getTime() + d * DAY;
      const ledger = foldFeedback(rows, now);
      const three = shortlist(withLedger(ledger));
      for (const id of three) {
        shownDays.set(id, (shownDays.get(id) ?? 0) + 1);
        cuisines.add(cuisineOf.get(id) ?? "");
        rows.push({ event: "rec_restaurant_viewed", props: { google_place_id: id }, created_at: new Date(now).toISOString() });
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\nCOVERAGE over 30 ignored days: ${shownDays.size} places, ${cuisines.size} cuisines, ` +
      `most-shown ${Math.max(...shownDays.values())} days (measured 2026-09-06: 26 places, 8 days)`);
    expect(shownDays.size).toBeGreaterThanOrEqual(20);
    expect(cuisines.size).toBeGreaterThanOrEqual(4);
    expect(Math.max(...shownDays.values())).toBeLessThanOrEqual(12);
  });
});

export { HERE, NOW, withLedger, fb, rankedBy };
