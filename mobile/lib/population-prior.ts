// ============================================================================
// population-prior.ts — the cold-start seed, from behaviour instead of a quiz.
// ----------------------------------------------------------------------------
// Replaces the starter quiz's persona prior for accounts that never took one,
// which is now every new account.
//
// The quiz asked five hypotheticals. This asks the database what people on
// Palate actually log and how they reacted to it. Three differences that
// matter:
//
//   • Nobody has to predict their own behaviour. Self-report is where the quiz
//     failed: its own author answered it and got a persona built on fast food.
//   • It cannot contradict itself. A persona was a single label pinned on a
//     person; this is a distribution over facets, and a distribution has no
//     opinion to be wrong about.
//   • It improves without anyone rewriting it. Every confirmed visit sharpens
//     the seed the next new account gets, which is the "learning as more data
//     comes in" half of the brief.
//
// Still deliberately WEAK. It applies only while real visits are sparse, and a
// handful of real ones outweighs it — the same contract the persona prior had.
// A prior is a starting guess, not a claim about somebody.
// ============================================================================
import { supabase } from "./supabase";
import type { TasteVector, WeightMap } from "./taste-vector";

/**
 * The same base as persona-prior's PRIOR_WEIGHT (1.0), so replacing one prior
 * with the other does not quietly change how hard cold start is steered.
 *
 * Each row is then scaled by its population weight, which is normalised to 1.0
 * for the leader of its facet. So the most common thing gets the full nudge and
 * the fifth-most barely registers — and because only the top few rows are
 * requested, total mass stays near the persona prior's rather than swamping it
 * with twenty equally-weighted keys.
 */
const POPULATION_PRIOR_WEIGHT = 1.0;

type PriorRow = { facet: string; value: string; weight: number };

/**
 * Fetch and apply. Silent and best-effort: a new user with no network gets the
 * un-seeded ranker, which is exactly what they got before any prior existed.
 */
export async function applyPopulationPrior(v: TasteVector, city?: string | null): Promise<boolean> {
  let rows: PriorRow[] = [];
  try {
    const { data, error } = await supabase.rpc("population_taste_prior", {
      p_city: city ?? null,
      p_limit: 5,
    });
    if (error || !Array.isArray(data)) return false;
    rows = data as PriorRow[];
  } catch {
    return false;
  }
  if (rows.length === 0) return false;

  applyPriorRows(v, rows);
  return true;
}

/** Pure half, so the weighting is testable without a network. */
export function applyPriorRows(v: TasteVector, rows: PriorRow[]): void {
  const target = (facet: string): WeightMap | null => {
    switch (facet) {
      case "cuisine_type":  return v.cuisineType;
      case "format_class":  return v.formatClass;
      case "price_tier":    return v.priceTier;
      case "occasion":      return v.occasion;
      default:              return null;
    }
  };

  for (const r of rows) {
    const map = target(r.facet);
    if (!map || !r.value) continue;
    // Scaled by the population weight, so the most common thing nudges hardest
    // and the fifth-most barely registers. A flat add would make a tail entry
    // as influential as the leader, which is how a prior becomes a preference.
    const w = Math.max(0, Math.min(1, Number(r.weight) || 0));
    map[r.value] = (map[r.value] ?? 0) + POPULATION_PRIOR_WEIGHT * w;
  }
}
