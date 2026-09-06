import visitsFixture from "../__fixtures__/founder-visit-places.json";
import { founderGraph, poolAsInputs } from "./ranking-harness.test";
import { scoreRestaurant } from "../scoring";
import type { TasteGraph } from "../taste-graph";

// ============================================================================
// Held-out visits: would the ranker have put the places he actually went
// near the top, built from everything except that place?
// ----------------------------------------------------------------------------
// Honest reading first. His 35 visits are 29 places, and only FOUR of them
// are inside the 200-row Memphis pool (the rest are other cities). Four
// reciprocal ranks are a smoke check, not a measurement: a change that
// moves the mean by a rank or two proves nothing either way. It is here so
// the number exists and so a change that buries every visited place shows
// up. The floor is deliberately loose.
// ============================================================================

type Row = { google_place_id: string; visited_at: string; cuisine_type: string | null };
const HERE = { lat: 35.098, lng: -89.841 };
const NOW = new Date(2026, 8, 8, 19, 30);

function without(g: TasteGraph, cuisine: string | null, region: string | null, sub: string | null, format: string | null, n: number): TasteGraph {
  const drop = (m: Record<string, number>, k: string | null) => {
    if (!k) return m;
    const out = { ...m };
    out[k] = Math.max(0, (out[k] ?? 0) - n);
    if (out[k] === 0) delete out[k];
    return out;
  };
  return {
    ...g,
    cuisineTypes: drop(g.cuisineTypes, cuisine),
    cuisines: drop(g.cuisines, region),
    cuisinesSubregion: drop(g.cuisinesSubregion, sub),
    formats: drop(g.formats, format),
    totalVisits: Math.max(0, g.totalVisits - n),
    restaurantVisits: {},
  };
}

describe("held-out visited places", () => {
  const pool = poolAsInputs();
  const byId = new Map(pool.map((r) => [r.google_place_id, r]));
  const counts = new Map<string, number>();
  for (const v of visitsFixture as Row[]) counts.set(v.google_place_id, (counts.get(v.google_place_id) ?? 0) + 1);
  const held = [...counts.entries()].filter(([id]) => byId.has(id));

  it("the fixture still reaches the pool", () => {
    // eslint-disable-next-line no-console
    console.log(`\nHELD-OUT: ${(visitsFixture as Row[]).length} visits, ${counts.size} places, ${held.length} inside the Memphis pool`);
    expect((visitsFixture as Row[]).length).toBeGreaterThanOrEqual(30);
    expect(held.length).toBeGreaterThanOrEqual(4);
  });

  it("ranks each visited place from a graph that never saw it, and none is buried", () => {
    const ranks: number[] = [];
    const lines: string[] = [];
    for (const [id, n] of held) {
      const r = byId.get(id)!;
      const g = without(founderGraph(), r.cuisine_type ?? null, r.cuisine_region ?? null, r.cuisine_subregion ?? null, r.format_class ?? null, n);
      const ranked = pool
        .map((p) => ({ p, final: scoreRestaurant(g, p, { here: HERE, now: NOW, mode: "browsing" }).finalScore }))
        .sort((a, b) => b.final - a.final);
      const rank = ranked.findIndex((t) => t.p.google_place_id === id) + 1;
      ranks.push(rank);
      lines.push(`  ${String(rank).padStart(3)}  ${r.name?.slice(0, 30).padEnd(31)} ${r.cuisine_type ?? "-"}  (${n} visit${n === 1 ? "" : "s"})`);
    }
    const mrr = ranks.reduce((s, k) => s + 1 / k, 0) / ranks.length;
    const hit10 = ranks.filter((k) => k <= 10).length;
    const hit30 = ranks.filter((k) => k <= 30).length;
    // eslint-disable-next-line no-console
    console.log(lines.join("\n") + `\n  MRR ${mrr.toFixed(3)}  hits@10 ${hit10}/${ranks.length}  hits@30 ${hit30}/${ranks.length}  (recorded 2026-09-06 as the baseline)`);
    // Baseline, 2026-09-06: ranks 178 / 6 / 27 / 178, MRR 0.054, hits@30 2 of 4.
    // The two at 178 are Italian and Mexican: cuisines he has eaten, but
    // which, with that one place removed, he had "never" eaten, and the
    // taste term reads never-eaten as a poor fit. A floor that read it as
    // neutral instead lifted every never-eaten cuisine together — the ranks
    // did not move — and broke good > unknown > poor on the real pool, so it
    // was reverted. The finding is real and this is where it is measured.
    // Asserted loosely, because four points cannot support more: a scorer
    // that puts NO visited place in its top thirty, from a graph that never
    // saw it, has broken.
    expect(hit30).toBeGreaterThanOrEqual(1);
  });
});
