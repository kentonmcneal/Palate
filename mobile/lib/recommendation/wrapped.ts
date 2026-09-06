// ============================================================================
// recommendation/wrapped.ts — composes weekly Wrapped from the taste graph.
// ----------------------------------------------------------------------------
// Outputs:
//   • weekly identity (with description + meaning)
//   • top cuisines, top neighborhoods
//   • exploration / repeat / comfort / stretch scores
//   • shareable summary string
//
// Wrapped is descriptive (not exploratory). All numbers come from the graph
// directly — no recomputation, no surprise weights.
//
// The Wrapped tab reads only `topCuisines` from this today; the `share` block
// has no on-screen consumer. Its strings are kept plain anyway so nothing in
// here can leak jargon if a surface picks it up later.
// ============================================================================

import type { TasteGraph } from "./taste-graph";
import { classifyFromGraph } from "./identity";
import type { PalateIdentity } from "../palate-labels";

export type WrappedSummary = {
  identity: PalateIdentity | null;
  totals: {
    visits: number;
    uniquePlaces: number;
    repeatRate: number;       // 0..1
    explorationRate: number;  // 0..1
  };
  topCuisines: { name: string; share: number }[];
  topNeighborhoods: { name: string; weight: number }[];
  scores: {
    exploration: number;  // 0..100 — higher = more discovery this week
    repeat: number;       // 0..100 — higher = more loyal to favorites
    comfort: number;      // 0..100 — derived from repeat + low novelty
    stretch: number;      // 0..100 — derived from exploration + cuisine diversity
  };
  /** Shareable headline, one-line summary, and a one-line nudge for next week. */
  share: {
    headline: string;     // identity label
    summary: string;      // one-liner suitable for stories
    nextEra: string;      // what to try next week, based on this one
  };
};

export function composeWrapped(graph: TasteGraph): WrappedSummary {
  const identity = classifyFromGraph(graph);

  const exploration = Math.round(graph.explorationRate * 100);
  const repeat = Math.round(graph.repeatRate * 100);
  const comfort = Math.round((1 - graph.explorationRate) * 0.6 * 100 + graph.repeatRate * 0.4 * 100);
  const cuisineDiversity = Object.keys(graph.cuisines).length;
  const stretch = Math.round(Math.min(1, cuisineDiversity / 8) * 60 + graph.explorationRate * 40);

  const totalCuisineWeight = Object.values(graph.cuisines).reduce((s, n) => s + n, 0) || 1;
  const topCuisines = Object.entries(graph.cuisines)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, n]) => ({ name, share: n / totalCuisineWeight }));

  const headline = identity?.label ?? "Warming up";
  const summaryParts: string[] = [];
  if (graph.totalVisits > 0) {
    summaryParts.push(`${graph.totalVisits} visit${graph.totalVisits === 1 ? "" : "s"} across ${graph.uniqueRestaurants} place${graph.uniqueRestaurants === 1 ? "" : "s"}`);
  }
  if (topCuisines[0]) {
    summaryParts.push(`mostly ${humanize(topCuisines[0].name)}`);
  }
  const summary = summaryParts.join(" · ") || "A quiet week. Log a few visits and Wrapped fills in.";

  const nextEra = graph.explorationRate >= 0.6
    ? "You keep finding new places. Keep going."
    : graph.repeatRate >= 0.55
    ? "Try one new spot this week."
    : "Pick one of the cuisines you keep coming back to and go deeper.";

  return {
    identity,
    totals: {
      visits: graph.totalVisits,
      uniquePlaces: graph.uniqueRestaurants,
      repeatRate: graph.repeatRate,
      explorationRate: graph.explorationRate,
    },
    topCuisines,
    topNeighborhoods: graph.topNeighborhoods.slice(0, 5),
    scores: { exploration, repeat, comfort, stretch },
    share: { headline, summary, nextEra },
  };
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
