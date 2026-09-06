// ============================================================================
// population-stats.ts — how strong your own signals are, and how many people
// are actually here.
// ----------------------------------------------------------------------------
// Nothing in this file invents a number any more.
//
// The cards are about YOU: "Strong in trying new restaurants" is a label on
// your own exploration rate, not a rank against anybody, and the file says so
// in the type. A real percentile needs a population distribution per metric,
// which is an aggregator job nobody has written.
//
// The cohort line is the only cross-user claim, it needs REAL_DATA_THRESHOLD
// real accounts, and when it cannot clear that it returns null and the card
// does not render. It used to fall back to a cohort generated from a hash of
// the identity's name, under the word "preview". See the note on
// CohortInsight.source for why that is gone.
// ============================================================================

import type { TasteVector } from "./taste-vector";
import type { PalateIdentity } from "./palate-labels";
import { supabase } from "./supabase";

const REAL_DATA_THRESHOLD = 25;

export type PercentileCard = {
  /** Qualitative intensity of the user's own signal ("Strong" / "Notable" / "Light") — NOT a percentile rank. */
  headline: string;
  /** What it's about ("in trying new restaurants"). */
  body: string;
  /** The user's own 0..100 self-score (not a rank vs. other users). */
  percentile: number;
};

export type CohortInsight = {
  /** The only line this app can actually source: a count of real accounts. */
  countLine: string;
  /**
   * Always "real". The type used to carry a "preview" mode alongside three
   * more lines (a meals-per-week pace, three cities, a top saved spot) that
   * were generated from a hash of the identity's own name. Worse, the REAL
   * branch spread that same object and replaced only the count, so a card
   * labelled real still told you your cohort eats 4.7 times a week and lives
   * in Brooklyn. There is no cohort data. The card now says the one thing
   * that is true, or it does not appear.
   */
  source: "real";
};

// ----------------------------------------------------------------------------
// Percentile cards — derived from the user's vector + persona.
//
// Each card takes a real signal from
// the vector and maps it to a plausible percentile. Same input always
// returns the same number (deterministic) so the user doesn't see numbers
// jumping around between renders.
// ----------------------------------------------------------------------------
export function generatePercentileCards(v: TasteVector, identity: PalateIdentity): PercentileCard[] {
  const out: PercentileCard[] = [];

  out.push({
    headline: intensityLabel(v.explorationRate),
    body: "in trying new restaurants this season",
    percentile: pctScore(v.explorationRate),
  });

  out.push({
    headline: intensityLabel(v.repeatRate),
    body: "in repeat-visit loyalty",
    percentile: pctScore(v.repeatRate),
  });

  const breadth = Object.keys(v.cuisineRegion).length;
  const breadthScore = Math.min(1, breadth / 8);
  out.push({
    headline: intensityLabel(breadthScore),
    body: `in cuisine variety (${breadth} different regions)`,
    percentile: pctScore(breadthScore),
  });

  const total = v.hourly.reduce((s, n) => s + n, 0);
  if (total > 0) {
    const late = (v.hourly[21] + v.hourly[22] + v.hourly[23] + v.hourly[0]) / total;
    if (late >= 0.2) {
      out.push({
        headline: intensityLabel(late),
        body: "in late-night eating",
        percentile: pctScore(late),
      });
    } else {
      const early = (v.hourly[6] + v.hourly[7] + v.hourly[8] + v.hourly[9]) / total;
      if (early >= 0.2) {
        out.push({
          headline: intensityLabel(early),
          body: "in early-morning eating",
          percentile: pctScore(early),
        });
      }
    }
  }

  if (v.neighborhoodLoyalty >= 0.4) {
    out.push({
      headline: intensityLabel(v.neighborhoodLoyalty),
      body: "in neighborhood loyalty. You tend to stick close to home",
      percentile: pctScore(v.neighborhoodLoyalty),
    });
  }

  return out.slice(0, 4);
}

// Qualitative intensity of the user's OWN signal — deliberately NOT a "Top X%"
// percentile. There's no population distribution to rank against, so any
// percentile would be a fabricated statistic (two friends could both be
// "Top 5%"). Describe the user's own signal instead.
function intensityLabel(signal: number): string {
  const s = Math.max(0, Math.min(1, signal));
  if (s >= 0.66) return "Strong";
  if (s >= 0.40) return "Notable";
  return "Light";
}

// The user's own 0..1 signal as a 0..100 (a self-score, NOT a rank vs others).
function pctScore(signal: number): number {
  return Math.round(Math.max(0, Math.min(1, signal)) * 100);
}

/** A real count of real accounts, or null. Never an estimate. */
export async function generateCohortInsightAsync(
  identity: PalateIdentity, v: TasteVector,
): Promise<CohortInsight | null> {
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
        return {
          countLine: `${count.toLocaleString()} ${count === 1 ? "person shares" : "people share"} your starter persona`,
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
      return { countLine: `${total.toLocaleString()} people on Palate so far`, source: "real" };
    }
  } catch {
    // ignore, and say nothing rather than invent something
  }

  // Nothing real to say. The old fallback built a cohort out of a hash of the
  // identity's own name: a count, a meals-per-week figure and three cities,
  // all invented, shipped under the word "preview". That is the same thing
  // the founder killed on 2026-09-05 when Top Palates in a city rendered a
  // ranking of five accounts, and for the same reason: a fabricated statistic
  // with a hedge attached still reads as a fact. Under the threshold the
  // honest answer is no card at all.
  return null;
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


function topByValue(map: Record<string, number>): string | null {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? null;
}
