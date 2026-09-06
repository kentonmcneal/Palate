import pool from "../__fixtures__/memphis-pool.json";
import visits from "../__fixtures__/founder-visits.json";
import { computeCompatibility } from "../compatibility";
import { scoreRestaurant } from "../scoring";
import { capByKey } from "../reranking";
import { venueOpenAt } from "../../opening-hours";
import type { TasteGraph } from "../taste-graph";
import type { RestaurantInput } from "../types";
import { EMPTY_DISLIKES } from "../../dislikes";

// ============================================================================
// The ranking harness — real pool, real palate.
// ----------------------------------------------------------------------------
// Every number in here comes from the live database (see __fixtures__). It
// exists because a hand-written fixture would have put a cuisine_region on
// every row and hidden the defect this measures: 79 of the 200 restaurants the
// app can actually recommend around Memphis have no region and no subregion,
// and 55 of those DO carry a cuisine_type the scorer never read.
// ============================================================================

type VisitRow = {
  cuisine_type: string | null; cuisine_region: string | null;
  cuisine_subregion: string | null; format_class: string | null;
  price_level: number | null; n: number;
};

function bump(m: Record<string, number>, k: string | null, n: number) {
  if (!k) return;
  m[k] = (m[k] ?? 0) + n;
}

/** The founder's graph, built from his real 35 visits. */
export function founderGraph(): TasteGraph {
  const g: Partial<TasteGraph> = {
    cuisines: {}, cuisinesSubregion: {}, cuisineTypes: {}, formats: {},
    occasions: {}, flavors: {}, neighborhoods: {}, priceLevels: {},
  };
  let total = 0;
  let priceSum = 0, priceN = 0;
  for (const v of visits as VisitRow[]) {
    total += v.n;
    bump(g.cuisines!, v.cuisine_region, v.n);
    bump(g.cuisinesSubregion!, v.cuisine_subregion, v.n);
    bump(g.cuisineTypes!, v.cuisine_type, v.n);
    bump(g.formats!, v.format_class, v.n);
    if (v.price_level != null) { priceSum += v.price_level * v.n; priceN += v.n; }
  }
  return {
    ...(g as TasteGraph),
    hours: new Array(24).fill(0),
    restaurantVisits: {},
    itemSentimentByRestaurant: new Map(),
    itemSentimentByCuisine: new Map(),
    friendVisitsByPlace: new Map(),
    dismissesByPlace: new Map(),
    skipsByPlace: new Map(),
    dislikes: EMPTY_DISLIKES,
    totalVisits: total,
    uniqueRestaurants: 27,
    repeatRate: 0.23,
    explorationRate: 0.77,
    averagePriceLevel: priceN ? priceSum / priceN : 0,
    weekendShare: 0.3,
    neighborhoodLoyalty: 0.4,
    geographicSpreadKm: 12,
    topNeighborhoods: [],
    dataDepth: "high",
  };
}

export function poolAsInputs(): RestaurantInput[] {
  return (pool as any[]).map((r) => ({
    google_place_id: r.google_place_id,
    name: r.name,
    cuisine_type: r.cuisine_type,
    cuisine_region: r.cuisine_region,
    cuisine_subregion: r.cuisine_subregion,
    format_class: r.format_class,
    price_level: r.price_level,
    rating: r.rating,
    user_rating_count: r.user_rating_count,
    neighborhood: r.neighborhood,
    latitude: r.latitude,
    longitude: r.longitude,
    chain_name: r.chain_name,
    is_chain_brand: r.is_chain_brand,
    primary_type: r.primary_type,
    types: r.types,
    dish_family: r.dish_family,
    regular_opening_hours: r.regular_opening_hours,
  })) as RestaurantInput[];
}

function ranked() {
  const g = founderGraph();
  return poolAsInputs()
    .map((r) => ({ r, score: computeCompatibility(g, r).score }))
    .sort((a, b) => b.score - a.score);
}

describe("ranking against the real Memphis pool", () => {
  it("prints the top ten, so a change can be seen rather than asserted", () => {
    const top = ranked().slice(0, 10);
    // eslint-disable-next-line no-console
    console.log("\nTOP 10:\n" + top.map((t, i) =>
      `${String(i + 1).padStart(2)}. ${String(t.score).padStart(3)}  ${t.r.name?.slice(0, 30).padEnd(31)}` +
      `type=${t.r.cuisine_type ?? "-"} region=${t.r.cuisine_region ?? "-"}`
    ).join("\n"));
    expect(top).toHaveLength(10);
  });

  it("reports how the unclassified rows place, which is the defect under test", () => {
    const all = ranked();
    const blind = all.filter((t) => !t.r.cuisine_region && !t.r.cuisine_subregion);
    const knownType = all.filter((t) => t.r.cuisine_type && !t.r.cuisine_region && !t.r.cuisine_subregion);
    const italian = all.filter((t) => t.r.cuisine_type === "italian");
    const avg = (xs: typeof all) => xs.length ? Math.round(xs.reduce((s, t) => s + t.score, 0) / xs.length) : 0;
    const rankOf = (t: typeof all[number]) => all.indexOf(t) + 1;
    // eslint-disable-next-line no-console
    console.log(
      `\nPOOL ${all.length}` +
      `\n  no region/sub:        ${blind.length}  avg ${avg(blind)}  best rank ${blind.length ? rankOf(blind[0]) : "-"}` +
      `\n  ...but HAS a type:    ${knownType.length}  avg ${avg(knownType)}` +
      `\n  italian (his 2nd cuisine): ${italian.length}  avg ${avg(italian)}  best rank ${italian.length ? rankOf(italian[0]) : "-"}` +
      `\n  top-10 with no cuisine at all: ${all.slice(0, 10).filter((t) => !t.r.cuisine_type).length}`
    );
    expect(all.length).toBeGreaterThan(100);
  });
});

// ============================================================================
// The ordering the whole taste term exists to produce.
// ----------------------------------------------------------------------------
// compatibility.ts states it in a comment: "good match > unknown > known-poor
// match". Before cuisine_type was read, that was false for 55 of the 200
// restaurants around Memphis — they had a known cuisine, the scorer refused to
// look, and they floated on UNKNOWN_TASTE_PRIOR above places it had correctly
// judged a poor fit.
// ============================================================================
describe("good match > unknown > known-poor match", () => {
  it("holds on the real pool", () => {
    const g = founderGraph();
    const all = poolAsInputs()
      .map((r) => ({ r, score: computeCompatibility(g, r).score }));

    // His dominant cuisine, by a distance: american appears in 12 of 27 groups.
    const good = all.filter((t) => t.r.cuisine_type === "american");
    // Nothing known at all: the UNKNOWN_TASTE_PRIOR population.
    const unknown = all.filter((t) => !t.r.cuisine_type && !t.r.cuisine_region && !t.r.cuisine_subregion);
    // Known, and not something he eats.
    const poor = all.filter((t) => t.r.cuisine_type && !["american", "steakhouse", "middle-eastern"].includes(t.r.cuisine_type));

    const avg = (xs: typeof all) => xs.reduce((s, t) => s + t.score, 0) / Math.max(1, xs.length);
    // eslint-disable-next-line no-console
    console.log(
      `\n  good (american, n=${good.length}):   ${avg(good).toFixed(1)}` +
      `\n  unknown (n=${unknown.length}):            ${avg(unknown).toFixed(1)}` +
      `\n  known-poor (n=${poor.length}):         ${avg(poor).toFixed(1)}`
    );
    expect(good.length).toBeGreaterThan(5);
    expect(unknown.length).toBeGreaterThan(5);
    expect(poor.length).toBeGreaterThan(5);
    expect(avg(good)).toBeGreaterThan(avg(unknown));
    expect(avg(unknown)).toBeGreaterThan(avg(poor));
  });

  it("scores a restaurant whose only cuisine signal is a type", () => {
    // The 55-row case. Before the fix these were indistinguishable from a
    // place we had never classified at all.
    const g = founderGraph();
    const typedOnly = { google_place_id: "x", name: "X", cuisine_type: "american",
      cuisine_region: null, cuisine_subregion: null } as never;
    const nothing = { google_place_id: "y", name: "Y", cuisine_type: null,
      cuisine_region: null, cuisine_subregion: null } as never;
    expect(computeCompatibility(g, typedOnly).score)
      .toBeGreaterThan(computeCompatibility(g, nothing).score);
  });
});

// ============================================================================
// The whole chain, on the real pool: finalScore, open-now, and the cap.
// ============================================================================
describe("what Home now actually shows", () => {
  const HERE = { lat: 35.098, lng: -89.841 };
  // A Tuesday at 7:30pm — dinner, when most places are open and some are not.
  const NOW = new Date(2026, 8, 8, 19, 30);

  function ranked() {
    const g = founderGraph();
    return poolAsInputs()
      .map((r) => ({
        r,
        compat: computeCompatibility(g, r).score,
        final: scoreRestaurant(g, r, { here: HERE, now: NOW, mode: "browsing" }).finalScore,
        open: venueOpenAt(r.regular_opening_hours, NOW),
      }))
      .sort((a, b) => b.final - a.final);
  }

  it("prints the shortlist the user would see", () => {
    const all = ranked();
    const top = capByKey(all, (t) => t.r.cuisine_type, 2, 3);
    // eslint-disable-next-line no-console
    console.log("\nSHORTLIST (Tue 7:30pm):\n" + top.map((t, i) =>
      `  ${i + 1}. final=${String(t.final).padStart(3)} match=${String(t.compat).padStart(3)} ` +
      `open=${t.open === null ? "?" : t.open ? "y" : "N"} ${t.r.name?.slice(0, 28).padEnd(29)}${t.r.cuisine_type ?? "-"}`
    ).join("\n"));
    expect(top).toHaveLength(3);
  });

  it("does not put a closed restaurant in the top ten", () => {
    const all = ranked();
    const closedInTop = all.slice(0, 10).filter((t) => t.open === false);
    const closedInPool = all.filter((t) => t.open === false).length;
    // eslint-disable-next-line no-console
    console.log(`\n  closed right now in the pool: ${closedInPool}` +
                `\n  closed inside the top 10:     ${closedInTop.length}` +
                `\n  best rank of a closed place:  ${all.findIndex((t) => t.open === false) + 1}`);
    expect(closedInPool).toBeGreaterThan(0);   // the test is meaningless otherwise
    expect(closedInTop).toHaveLength(0);

    // And prove the gate is what did it, not luck. Ranked the way Home ranked
    // before today — compatibility alone, no context — closed places reach the
    // top of the list.
    const g = founderGraph();
    const byCompatOnly = poolAsInputs()
      .map((r) => ({ r, compat: computeCompatibility(g, r).score, open: venueOpenAt(r.regular_opening_hours, NOW) }))
      .sort((a, b) => b.compat - a.compat);
    const closedBefore = byCompatOnly.slice(0, 10).filter((t) => t.open === false).length;
    // eslint-disable-next-line no-console
    console.log(`  closed in top 10 ranking by compatibility alone: ${closedBefore}`);
    expect(closedBefore).toBeGreaterThan(0);
  });

  it("does not hand back three of the same cuisine", () => {
    const top = capByKey(ranked(), (t) => t.r.cuisine_type, 2, 3);
    const cuisines = top.map((t) => (t.r.cuisine_type ?? "").toLowerCase());
    const counts = new Map<string, number>();
    for (const c of cuisines) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(Math.max(0, ...counts.values())).toBeLessThanOrEqual(2);
  });
});
