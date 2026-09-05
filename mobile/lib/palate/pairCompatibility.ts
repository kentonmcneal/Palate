// ============================================================================
// pairCompatibility.ts — friend↔friend palate compatibility + "where should we
// eat together" joint recommendations.
// ----------------------------------------------------------------------------
// Ties together existing pure primitives:
//   - taste-vector `aggregate()`      → build a friend's TasteVector from their
//                                        visit rows (fetched via a gated RPC)
//   - palateScoring                   → PalateProfile for each person
//   - palateCompatibility.compareProfiles → the 1:1 compatibility result
//   - recommendation scorer           → score nearby places for BOTH people
//
// READINESS GATE: the feature only "lights up" when BOTH people have enough
// logged visits (PAIR_READY_MIN_VISITS). Below that it returns { ready:false }
// with progress so the UI can show "keep logging to unlock" instead of noise.
//
// Two correctness safeguards baked in (see code map):
//   1. getUserPalateProfile(..., { useSmoothing:false }) — never let a friend's
//      profile touch the device-global smoothing cache (would corrupt YOUR
//      palate).
//   2. call the PURE computeCompatibility(graph, r) — NOT the cached
//      getCompatibility (global single-slot cache → cross-user contamination).
// ============================================================================

import { supabase } from "../supabase";
import { aggregate, computeTasteVector, type TasteVector } from "../taste-vector";
import { assembleGraph } from "../recommendation/taste-graph";
import { computeCompatibility } from "../recommendation/compatibility";
import { generateCandidates } from "../recommendation/candidates";
import { getUserPalateProfile, vectorToWeeklyData } from "./palateScoring";
import { compareProfiles } from "./palateCompatibility";
import type { CompatibilityResult } from "./palateTypes";
import { loadPersonalSignal } from "../personal-signal";
import {
  computePalateMatch,
  MATCH_MIN_VISITS,
  type PalateMatch,
} from "../recommendation/palate-match";

/** Both people need at least this many visits for a meaningful taste profile. */
export const PAIR_READY_MIN_VISITS = 5;

export type PairPick = {
  google_place_id: string;
  name: string;
  cuisine: string | null;
  jointScore: number; // 0..100 — min(you, them), so it's good for BOTH
  yourScore: number;
  theirScore: number;
};

export type PairResult =
  | {
      ready: false;
      authorized: boolean;
      yourVisits: number;
      theirVisits: number;
      threshold: number;
    }
  | { ready: true; compat: CompatibilityResult; picks: PairPick[] };

type FriendTasteResponse = {
  authorized: boolean;
  reason?: string;
  visit_count?: number;
  visits?: Array<{
    visited_at: string;
    meal_type: string | null;
    restaurant: unknown;
  }>;
};

async function loadFriendVector(
  targetId: string,
): Promise<{ authorized: boolean; vector: TasteVector | null; visitCount: number; placeIds: Set<string> }> {
  const { data, error } = await supabase.rpc("friend_taste_features", {
    target_id: targetId,
  });
  if (error) throw error;
  const res = (data ?? { authorized: false }) as FriendTasteResponse;
  if (!res.authorized) return { authorized: false, vector: null, visitCount: 0, placeIds: new Set() };
  // The RPC returns rows in exactly the shape aggregate() consumes.
  const vector = aggregate((res.visits ?? []) as never, []);
  // Which restaurants they have been to — the shared-place overlap in the
  // palate match is computed from this, never from a broader read.
  const placeIds = new Set<string>();
  for (const v of res.visits ?? []) {
    const gid = (v.restaurant as { google_place_id?: string } | null)?.google_place_id;
    if (gid) placeIds.add(gid);
  }
  return {
    authorized: true,
    vector,
    visitCount: res.visit_count ?? vector.visitCount,
    placeIds,
  };
}

export async function computePairCompatibility(
  targetId: string,
  here?: { lat: number; lng: number } | null,
): Promise<PairResult> {
  const [myVector, friend] = await Promise.all([
    computeTasteVector(),
    loadFriendVector(targetId),
  ]);

  if (!friend.authorized || !friend.vector) {
    return {
      ready: false,
      authorized: false,
      yourVisits: myVector.visitCount,
      theirVisits: 0,
      threshold: PAIR_READY_MIN_VISITS,
    };
  }

  // Readiness gate — both people need enough data.
  if (
    myVector.visitCount < PAIR_READY_MIN_VISITS ||
    friend.visitCount < PAIR_READY_MIN_VISITS
  ) {
    return {
      ready: false,
      authorized: true,
      yourVisits: myVector.visitCount,
      theirVisits: friend.visitCount,
      threshold: PAIR_READY_MIN_VISITS,
    };
  }

  // Profiles — useSmoothing:false so the friend's profile never writes to the
  // device-global smoothing cache (safeguard #1).
  const [myProfile, friendProfile] = await Promise.all([
    getUserPalateProfile(vectorToWeeklyData(myVector), { useSmoothing: false }),
    getUserPalateProfile(vectorToWeeklyData(friend.vector), { useSmoothing: false }),
  ]);
  const compat = compareProfiles(myProfile, friendProfile);

  // Joint picks — only when we have a location to search around.
  let picks: PairPick[] = [];
  if (here) {
    // With the personal signal, so the viewer's "Not interested" places are
    // excluded from the joint picks.
    const myGraph = assembleGraph(myVector, await loadPersonalSignal().catch(() => null));
    const friendGraph = assembleGraph(friend.vector, null);
    // Fetch nearby ONCE (inside generateCandidates for my graph), then score
    // each candidate for BOTH graphs via the pure scorer (safeguard #2).
    const cands = await generateCandidates({ graph: myGraph, here });
    picks = cands
      .map((c) => {
        const yours = computeCompatibility(myGraph, c.restaurant).score;
        const theirs = computeCompatibility(friendGraph, c.restaurant).score;
        return {
          google_place_id: c.restaurant.google_place_id,
          name: c.restaurant.name,
          cuisine: c.restaurant.cuisine_region ?? c.restaurant.cuisine_type ?? null,
          jointScore: Math.min(yours, theirs),
          yourScore: yours,
          theirScore: theirs,
        };
      })
      .sort((a, b) => b.jointScore - a.jointScore)
      .slice(0, 5);
  }

  return { ready: true, compat, picks };
}

// ----------------------------------------------------------------------------
// Palate Match — the shareable number
// ----------------------------------------------------------------------------
// compareProfiles() above returns a qualitative verdict, which is the honest
// shape of the data and completely unshareable. A tester asked for the Spotify
// Blend treatment: one number, with the reasons underneath. See
// SOCIAL_DESIGN.md — both models are kept, deliberately.

/**
 * Load one friend's palate match. Reads the friend's vector through
 * friend_taste_features, which enforces the friendship check server-side —
 * this never widens access.
 */
export async function loadPalateMatch(targetId: string): Promise<PalateMatch> {
  const [mine, friend, myPlaces] = await Promise.all([
    computeTasteVector(),
    loadFriendVector(targetId),
    loadPersonalSignal().catch(() => null),
  ]);

  if (!friend.authorized || !friend.vector) {
    return {
      ready: false,
      yourVisits: mine.visitCount,
      theirVisits: 0,
      threshold: MATCH_MIN_VISITS,
    };
  }

  // Shared-place overlap. The friend RPC returns their visited restaurants, so
  // this is computed from data we are already authorized to read.
  const mineIds = new Set(myPlaces?.visitsByPlaceId.keys() ?? []);
  const theirIds = friend.placeIds;
  let shared = 0;
  for (const id of theirIds) if (mineIds.has(id)) shared++;
  const union = new Set([...mineIds, ...theirIds]).size;

  return computePalateMatch(mine, friend.vector, {
    sharedPlaceCount: shared,
    unionPlaceCount: union,
  });
}



/**
 * Palate match for MANY people in one round trip.
 *
 * The per-person loadPalateMatch() is correct and stays — the profile screen
 * genuinely wants one person. But a directory rendering N rows was making N
 * calls, each one re-fetching the CALLER'S own vector as well. This computes
 * the caller's side once and reuses it.
 *
 * Unauthorized entries come back as not-ready rather than being dropped, so a
 * caller can tell "you can't see this person" from "this person has no data" —
 * batching must not quietly widen or narrow what you're allowed to know.
 */
export async function loadPalateMatches(
  targetIds: string[],
): Promise<Record<string, PalateMatch>> {
  const ids = [...new Set(targetIds)].filter(Boolean).slice(0, 100);
  if (ids.length === 0) return {};

  const [mine, personal, batch] = await Promise.all([
    computeTasteVector(),
    loadPersonalSignal().catch(() => null),
    supabase.rpc("friend_taste_features_batch", { target_ids: ids }),
  ]);

  if (batch.error) throw batch.error;
  const payload = (batch.data ?? {}) as Record<string, FriendTasteResponse>;
  const mineIds = new Set(personal?.visitsByPlaceId.keys() ?? []);

  const out: Record<string, PalateMatch> = {};
  for (const id of ids) {
    const res = payload[id];
    if (!res?.authorized) {
      out[id] = {
        ready: false,
        yourVisits: mine.visitCount,
        theirVisits: 0,
        threshold: MATCH_MIN_VISITS,
      };
      continue;
    }

    const vector = aggregate((res.visits ?? []) as never, []);
    const theirIds = new Set<string>();
    for (const v of res.visits ?? []) {
      const gid = (v.restaurant as { google_place_id?: string } | null)?.google_place_id;
      if (gid) theirIds.add(gid);
    }
    let shared = 0;
    for (const gid of theirIds) if (mineIds.has(gid)) shared++;

    out[id] = computePalateMatch(mine, vector, {
      sharedPlaceCount: shared,
      unionPlaceCount: new Set([...mineIds, ...theirIds]).size,
    });
  }
  return out;
}
