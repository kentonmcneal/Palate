// ============================================================================
// population-stats.ts — percentiles + "people like you" cohort.
// ----------------------------------------------------------------------------
// Auto-swaps fake → real:
//   - When the real cohort (population_palate_counts view) reaches
//     REAL_DATA_THRESHOLD users, the cohort line uses the real count.
//   - Percentile cards always use vector-derived values for now (real
//     percentile math needs population distributions for each metric, not
//     just user counts — that's a future aggregator job).
// ============================================================================

import type { TasteVector } from "./taste-vector";
import type { PalateIdentity } from "./palate-labels";
import { supabase } from "./supabase";

const REAL_DATA_THRESHOLD = 25;

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
  /** "real" once we have enough users; "preview" until then */
  source: "real" | "preview";
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
// "People like you" cohort — synchronous (fake) version, kept for backwards
// compat with existing UI calls.
// ----------------------------------------------------------------------------
export function generateCohortInsight(identity: PalateIdentity, v: TasteVector): CohortInsight {
  return generateFakeCohort(identity, v);
}

/** Async version: tries real data first, falls back to fake. */
export async function generateCohortInsightAsync(
  identity: PalateIdentity, v: TasteVector,
): Promise<CohortInsight> {
  // Map an identity label down to a starter persona key when possible.
  // Falls back to total-population count for anyone that didn't quiz in.
  const personaKey = identityToQuizKey(identity.label);

  try {
    if (personaKey) {
      const { data } = await supabase
        .from("population_palate_counts")
        .select("palate_key, user_count")
        .eq("palate_key", personaKey)
        .maybeSingle();
      const count = (data as any)?.user_count ?? 0;
      if (count >= REAL_DATA_THRESHOLD) {
        const fake = generateFakeCohort(identity, v);
        return {
          ...fake,
          countLine: `${count.toLocaleString()} Palate${count === 1 ? "" : "s"} share your starter persona`,
          source: "real",
        };
      }
    }
    // No real data threshold met — try total-users line as a softer real signal.
    const { data: totalRow } = await supabase
      .from("population_total")
      .select("total_users")
      .maybeSingle();
    const total = (totalRow as any)?.total_users ?? 0;
    if (total >= REAL_DATA_THRESHOLD * 4) {
      const fake = generateFakeCohort(identity, v);
      return {
        ...fake,
        countLine: `${total.toLocaleString()} people on Palate so far`,
        source: "real",
      };
    }
  } catch {
    // ignore — fall through to fake
  }

  return generateFakeCohort(identity, v);
}

function generateFakeCohort(identity: PalateIdentity, v: TasteVector): CohortInsight {
  const seed = hashOffset(identity.label) + identity.label.length;

  const cohortPct = 0.005 + (seed % 5) * 0.003;
  const cohortCount = Math.max(800, Math.round(50_000 * cohortPct));

  const pace = (3.0 + ((seed * 7) % 30) / 10).toFixed(1);

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

  const exemplar = pickExemplar(identity.label, v);

  return {
    countLine: `${cohortCount.toLocaleString()} Palates eat like you`,
    paceLine: `They average ${pace} eating-out meals a week`,
    citiesLine: `Most concentrated in: ${cities.join(", ")}`,
    topSavedLine: `Top saved spot in this cohort: ${exemplar}`,
    source: "preview",
  };
}

// Best-effort mapping from a composed identity label back to a starter persona
// key. Used only for the real-data lookup; falls through to total-users when
// no match.
function identityToQuizKey(label: string): string | null {
  const l = label.toLowerCase();
  if (l.includes("convenience")) return "convenience_loyalist";
  if (l.includes("flavor loyalist") || l.includes("flavor-loyal")) return "flavor_loyalist";
  if (l.includes("premium") || l.includes("connoisseur")) return "premium_comfort_loyalist";
  if (l.includes("variety")) return "practical_variety_seeker";
  if (l.includes("explorer") || l.includes("cartographer") || l.includes("seeker")) return "explorer";
  if (l.includes("café") || l.includes("cafe")) return "cafe_dweller";
  if (l.includes("comfort")) return "comfort_connoisseur";
  if (l.includes("fast-casual") || l.includes("fast casual")) return "fast_casual_regular";
  if (l.includes("social") || l.includes("group")) return "social_diner";
  return null;
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
