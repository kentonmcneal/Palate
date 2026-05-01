// ============================================================================
// population-stats.ts — FAKE aggregated "people like you" data.
// ----------------------------------------------------------------------------
// Until we have real population statistics, we generate plausible-feeling
// values from the user's own taste vector + persona key. This lets us
// design + ship the percentile + cohort UX while we build a real aggregator
// in the background.
//
// Marked "preview data" anywhere we surface these so testers don't think
// they're querying a real population yet. Easy swap-out later: replace
// the body of these functions with a real query against a server-side
// aggregator job.
// ============================================================================

import type { TasteVector } from "./taste-vector";
import type { PalateIdentity } from "./palate-labels";

export type PercentileCard = {
  /** Short headline ("Top 12%") */
  headline: string;
  /** What the percentile is for ("in trying new restaurants") */
  body: string;
  /** Numerical percentile value 0..100 */
  percentile: number;
};

export type CohortInsight = {
  /** "12,400 Palate users eat like you" */
  countLine: string;
  /** "They average 4.2 visits a week" */
  paceLine: string;
  /** "Top cities for this Palate: Brooklyn, LA, Austin" */
  citiesLine: string;
  /** "Most-saved spot in the cohort: Lucali" */
  topSavedLine: string;
};

// ----------------------------------------------------------------------------
// Percentile cards — derived from the user's vector + persona.
//
// Each card uses a "preview data" generator that takes a real signal from
// the vector and maps it to a plausible percentile. Same input always
// returns the same number (deterministic) so the user doesn't see numbers
// jumping around between renders.
// ----------------------------------------------------------------------------
export function generatePercentileCards(v: TasteVector, identity: PalateIdentity): PercentileCard[] {
  const out: PercentileCard[] = [];

  // Exploration: high explorationRate → high percentile in "trying new"
  out.push({
    headline: `Top ${pctRank(v.explorationRate, "explore")}%`,
    body: "in trying new restaurants this season",
    percentile: pctRank(v.explorationRate, "explore"),
  });

  // Loyalty: high repeatRate → high percentile in "repeat behavior"
  out.push({
    headline: `Top ${pctRank(v.repeatRate, "repeat")}%`,
    body: "in repeat-visit loyalty",
    percentile: pctRank(v.repeatRate, "repeat"),
  });

  // Cuisine breadth
  const breadth = Object.keys(v.cuisineRegion).length;
  const breadthScore = Math.min(1, breadth / 8);
  out.push({
    headline: `Top ${pctRank(breadthScore, "breadth")}%`,
    body: `in cuisine variety (${breadth} different regions)`,
    percentile: pctRank(breadthScore, "breadth"),
  });

  // Late-night vs. early
  const total = v.hourly.reduce((s, n) => s + n, 0);
  if (total > 0) {
    const late = (v.hourly[21] + v.hourly[22] + v.hourly[23] + v.hourly[0]) / total;
    if (late >= 0.2) {
      out.push({
        headline: `Top ${pctRank(late, "late")}%`,
        body: "in late-night eating frequency",
        percentile: pctRank(late, "late"),
      });
    } else {
      const early = (v.hourly[6] + v.hourly[7] + v.hourly[8] + v.hourly[9]) / total;
      if (early >= 0.2) {
        out.push({
          headline: `Top ${pctRank(early, "early")}%`,
          body: "in early-morning eating",
          percentile: pctRank(early, "early"),
        });
      }
    }
  }

  // Neighborhood loyalty
  if (v.neighborhoodLoyalty >= 0.4) {
    out.push({
      headline: `Top ${pctRank(v.neighborhoodLoyalty, "hood")}%`,
      body: "in neighborhood loyalty — most users roam more",
      percentile: pctRank(v.neighborhoodLoyalty, "hood"),
    });
  }

  return out.slice(0, 4);
}

// Deterministic-ish "percentile" — maps a 0..1 signal to a top-N% rank.
// Stronger signals → smaller "Top X%" number. The slug seeds variation so
// different metrics don't all show identical numbers when underlying values
// are similar.
function pctRank(signal: number, slug: string): number {
  const clamped = Math.max(0, Math.min(1, signal));
  // Base mapping: signal 1.0 → top 5%, signal 0.5 → top 30%, signal 0 → top 70%
  const base = Math.round(70 - clamped * 65);
  // Add deterministic offset per metric so cards differ a bit
  const offset = hashOffset(slug);
  return Math.max(2, Math.min(85, base + offset));
}

function hashOffset(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 7) - 3; // -3..+3
}

// ----------------------------------------------------------------------------
// "People like you" cohort — fake plausible values keyed on the persona label.
// ----------------------------------------------------------------------------
export function generateCohortInsight(identity: PalateIdentity, v: TasteVector): CohortInsight {
  const seed = hashOffset(identity.label) + identity.label.length;

  // Cohort size — pretend Palate has ~50,000 users; cohort is a slice
  const cohortPct = 0.005 + (seed % 5) * 0.003;
  const cohortCount = Math.max(800, Math.round(50_000 * cohortPct));

  // Pace
  const pace = (3.0 + ((seed * 7) % 30) / 10).toFixed(1);

  // Top cities — pick from a fixed pool, slug-deterministic
  const cityPool = [
    ["Brooklyn", "Austin", "LA"],
    ["Manhattan", "Chicago", "SF"],
    ["Queens", "Atlanta", "Boston"],
    ["Brooklyn", "Philadelphia", "Portland"],
    ["LA", "Miami", "Brooklyn"],
    ["Chicago", "Seattle", "DC"],
    ["Atlanta", "Houston", "Brooklyn"],
  ];
  const cities = cityPool[(seed >>> 0) % cityPool.length];

  // Top-saved exemplar — pull from the persona's stretch picks if available;
  // otherwise generic.
  const exemplar = pickExemplar(identity.label, v);

  return {
    countLine: `${cohortCount.toLocaleString()} Palates eat like you`,
    paceLine: `They average ${pace} eating-out meals a week`,
    citiesLine: `Most concentrated in: ${cities.join(", ")}`,
    topSavedLine: `Top saved spot in this cohort: ${exemplar}`,
  };
}

function pickExemplar(label: string, v: TasteVector): string {
  const sub = topByValue(v.cuisineSubregion);
  const region = topByValue(v.cuisineRegion);
  if (sub === "memphis_bbq") return "Central BBQ";
  if (sub === "korean_bbq") return "Cote";
  if (sub === "japanese_sushi") return "Sushi Noz";
  if (sub === "japanese_ramen") return "Ippudo";
  if (sub === "vietnamese_pho") return "Saigon Social";
  if (sub === "italian_neapolitan") return "Lucali";
  if (sub === "italian_pizzeria") return "Joe's Pizza";
  if (sub === "mexican_taqueria") return "Los Tacos No. 1";
  if (sub === "halal_cart") return "The Halal Guys";
  if (sub === "korean") return "Atomix";
  if (sub === "café") return "Blue Bottle";
  if (region === "southern_us") return "Sweet Chick";
  if (region === "east_asian") return "Kru";
  if (region === "latin_american") return "Llama San";
  if (region === "italian") return "Lilia";
  if (label.toLowerCase().includes("brunch")) return "Tatte Bakery";
  if (label.toLowerCase().includes("late-night")) return "The Halal Guys";
  return "Sweetgreen";
}

function topByValue(map: Record<string, number>): string | null {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? null;
}
