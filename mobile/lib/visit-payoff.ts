// ============================================================================
// visit-payoff.ts — one true line about what logging that meal just did.
// ----------------------------------------------------------------------------
// THE SWARM PROBLEM, which is the one that should worry this product most.
//
// Foursquare had check-ins and a social graph, moved to automatic detection,
// and collapsed. The technology got better and the product died, because
// passive logging removed the RITUAL — the moment where you did something and
// it was yours. A check-in was an act. A confirmed detection is a dismissed
// notification.
//
// Palate is walking the same road with better technology and has exactly the
// same exposure. The confirm prompt IS our ritual, and right now it ends by
// clearing an alert. This gives it a payoff: one line, immediately, saying what
// the visit changed.
//
// Rules that keep it honest, because a fake payoff is worse than none:
//   • every line is computed from stored data — no invented milestones
//   • the most SPECIFIC true thing wins, not the most flattering
//   • never claims a first when it is a fourth
//   • returns null rather than reaching for filler
// ============================================================================

import { supabase } from "./supabase";
import { visitsToWrapped } from "./visits";
import { captureError } from "./observability";

export type VisitFacts = {
  /** Total visits this user has logged, INCLUDING the one just logged. */
  totalVisits: number;
  /** Times they have been to this restaurant, including now. */
  visitsHere: number;
  /** Cuisine of the place, if known. */
  cuisine: string | null;
  /** Visits to this cuisine in the last 30 days, including now. */
  cuisineVisits30d: number;
  /** Distinct restaurants ever logged, including this one. */
  distinctPlaces: number;
  /**
   * Visits still needed before Wrapped unlocks — straight from
   * `visitsToWrapped()`, so the threshold lives in one place and this can
   * never nudge toward something the app has already unlocked.
   */
  visitsToWrapped: number;
  /** True when this visit is the one that made this place their most-visited. */
  becameTopSpot: boolean;
};

function label(cuisine: string): string {
  return cuisine
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/**
 * The single line to show after a confirmed visit, or null when nothing true
 * and interesting can be said.
 *
 * Ordered by how much the fact would actually mean to the person, not by how
 * impressive it sounds. "Your top spot changed" beats "4th visit" beats
 * "3 more until Wrapped".
 */
export function visitPayoff(f: VisitFacts): string | null {
  // The very first one is genuinely a milestone, and only once.
  if (f.totalVisits === 1) {
    return "That's your first. Your palate starts here.";
  }

  // A changed favourite is the most interesting thing that can happen.
  if (f.becameTopSpot && f.visitsHere >= 2) {
    return "That just became your most-visited place.";
  }

  // Repeat visits say more about taste than a new place does.
  if (f.visitsHere >= 3) {
    return `${ordinal(f.visitsHere)} time here — you're a regular.`;
  }
  if (f.visitsHere === 2) {
    return "Second time here.";
  }

  // A cuisine pattern the person may not have noticed about themselves.
  if (f.cuisine && f.cuisineVisits30d >= 3) {
    return `That's ${f.cuisineVisits30d} ${label(f.cuisine)} meals this month.`;
  }

  // Concrete, close, and actionable beats a vague nudge.
  if (f.visitsToWrapped > 0 && f.visitsToWrapped <= 2) {
    return f.visitsToWrapped === 1
      ? "One more and your Wrapped unlocks."
      : `${f.visitsToWrapped} more and your Wrapped unlocks.`;
  }

  if (f.distinctPlaces >= 2 && f.visitsHere === 1) {
    return `New place — that's ${f.distinctPlaces} you've been to.`;
  }

  // Nothing worth saying. Say nothing.
  return null;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

type FactsRow = {
  total_visits: number;
  visits_here: number;
  cuisine: string | null;
  cuisine_visits_30d: number;
  distinct_places: number;
  became_top_spot: boolean;
};

/**
 * The line to show after a confirmed visit, or null.
 *
 * Never throws and never blocks: this runs on the screen that appears right
 * after a confirm, and a payoff line failing is not a reason to interrupt
 * someone who has just logged a meal.
 */
export async function loadVisitPayoff(visitId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .rpc("visit_payoff_facts", { p_visit_id: visitId })
      .maybeSingle<FactsRow>();
    if (error || !data) return null;
    return visitPayoff({
      totalVisits: data.total_visits,
      visitsHere: data.visits_here,
      cuisine: data.cuisine,
      cuisineVisits30d: data.cuisine_visits_30d,
      distinctPlaces: data.distinct_places,
      visitsToWrapped: visitsToWrapped(data.total_visits),
      becameTopSpot: data.became_top_spot,
    });
  } catch (e: unknown) {
    void captureError(e, { at: "visitPayoff:load" });
    return null;
  }
}
