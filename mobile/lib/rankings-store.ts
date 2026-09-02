// ============================================================================
// rankings-store.ts — persistence for the ranked list.
// ----------------------------------------------------------------------------
// The maths lives in ranking.ts and is pure. This is the only part that talks to
// Postgres, so the algorithm stays testable without a database.
//
// Every answer writes twice: the two updated ratings (current state, what the UI
// reads) and one row in rating_comparisons (the append-only log, which is what
// makes the ratings recomputable if the K-factor ever changes). See 0062.
// ============================================================================

import { supabase } from "./supabase";
import {
  DEFAULT_RATING,
  applyComparison,
  pickOpponent,
  rankedOrder,
  type Rated,
} from "./ranking";

export type RankedPlace = Rated & {
  name: string;
  cuisine: string | null;
  googlePlaceId: string;
};

type Row = {
  restaurant_id: string;
  rating: number;
  comparisons: number;
  restaurant: { name: string; cuisine_type: string | null; google_place_id: string }
    | { name: string; cuisine_type: string | null; google_place_id: string }[]
    | null;
};

function toRanked(row: Row): RankedPlace | null {
  const r = Array.isArray(row.restaurant) ? row.restaurant[0] : row.restaurant;
  if (!r) return null;
  return {
    restaurantId: row.restaurant_id,
    rating: row.rating,
    comparisons: row.comparisons,
    name: r.name,
    cuisine: r.cuisine_type,
    googlePlaceId: r.google_place_id,
  };
}

/** The user's ranked list, best first. */
export async function loadRankedPlaces(userId?: string): Promise<RankedPlace[]> {
  const uid = userId ?? (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from("place_ratings")
    .select("restaurant_id, rating, comparisons, restaurant:restaurants(name, cuisine_type, google_place_id)")
    .eq("user_id", uid)
    .order("rating", { ascending: false })
    .limit(200);
  if (error) throw error;

  const places = ((data ?? []) as Row[]).map(toRanked).filter((p): p is RankedPlace => p !== null);
  // Re-sort locally so the tie-break rule (established beats newcomer) is the
  // same one the tests pin, rather than whatever Postgres does with equal keys.
  return rankedOrder(places) as RankedPlace[];
}

/**
 * The single question to ask after a visit, or null when there is nothing
 * useful to ask — a first-ever rated place has nobody to be compared against,
 * and inventing an opponent would teach us nothing.
 */
export async function nextComparison(
  subjectRestaurantId: string,
): Promise<{ subject: RankedPlace; opponent: RankedPlace } | null> {
  const pool = await loadRankedPlaces();
  if (pool.length === 0) return null;

  const subject = pool.find((p) => p.restaurantId === subjectRestaurantId);
  if (!subject) return null;

  const opponent = pickOpponent(subject, pool) as RankedPlace | null;
  if (!opponent) return null;
  return { subject, opponent };
}

/** Ensure a place has a rating row so it can enter the pool. Idempotent. */
export async function ensureRated(restaurantId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("place_ratings")
    .upsert(
      {
        user_id: user.id,
        restaurant_id: restaurantId,
        rating: DEFAULT_RATING,
        comparisons: 0,
      },
      { onConflict: "user_id,restaurant_id", ignoreDuplicates: true },
    );
}

/** Record one answer: both ratings, plus the log row. */
export async function recordComparison(
  winner: Rated,
  loser: Rated,
): Promise<{ winner: Rated; loser: Rated }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const next = applyComparison(winner, loser);
  const now = new Date().toISOString();

  const { error: upsertErr } = await supabase.from("place_ratings").upsert(
    [
      {
        user_id: user.id,
        restaurant_id: next.winner.restaurantId,
        rating: next.winner.rating,
        comparisons: next.winner.comparisons,
        updated_at: now,
      },
      {
        user_id: user.id,
        restaurant_id: next.loser.restaurantId,
        rating: next.loser.rating,
        comparisons: next.loser.comparisons,
        updated_at: now,
      },
    ],
    { onConflict: "user_id,restaurant_id" },
  );
  if (upsertErr) throw upsertErr;

  // The log is best-effort: losing it costs recomputability later, but failing
  // the whole answer because of it would cost the user their input now.
  await supabase
    .from("rating_comparisons")
    .insert({
      user_id: user.id,
      winner_id: next.winner.restaurantId,
      loser_id: next.loser.restaurantId,
    })
    .then(undefined, () => {});

  return next;
}
