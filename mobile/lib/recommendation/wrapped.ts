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
  /** Shareable headline + one-line summary for "Your next era" */
  share: {
    headline: string;     // identity label
    summary: string;      // one-liner suitable for stories
    nextEra: string;      // aspirational nudge based on stretch behavior
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

  const headline = identity?.label ?? "Pattern Forming";
  const summaryParts: string[] = [];
  if (graph.totalVisits > 0) {
    summaryParts.push(`${graph.totalVisits} visit${graph.totalVisits === 1 ? "" : "s"} across ${graph.uniqueRestaurants} place${graph.uniqueRestaurants === 1 ? "" : "s"}`);
  }
  if (topCuisines[0]) {
    summaryParts.push(`leaning ${humanize(topCuisines[0].name)}`);
  }
  const summary = summaryParts.join(" · ") || "A quiet week. Log a few visits and we'll start the picture.";

  const nextEra = graph.explorationRate >= 0.6
    ? "Your next era: keep wandering — the map's getting bigger every week."
    : graph.repeatRate >= 0.55
    ? "Your next era: try one new spot this week. Stretch the routine."
    : "Your next era: lean into the cuisines you've been circling.";

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
