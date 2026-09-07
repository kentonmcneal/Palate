// ============================================================================
// personal-signal.ts — the user-specific layer that the scorers consume.
// ----------------------------------------------------------------------------
// Pulls everything personal in one round-trip:
//   • visit counts per place (anti-staleness penalty)
//   • the per-place feedback ledger (recommendation/feedback.ts)
//   • menu-item ratings, aggregated per restaurant + per cuisine (item-level
//     loves/dislikes feed both restaurant scoring and item↔cuisine cross-
//     learning, e.g. "loves hummus" → boost Mediterranean spots)
//   • friend visits (social proof boost)
//
// One module-level cache keyed by user — every screen calls `loadPersonalSignal`
// and gets the same object until invalidate is called (we re-fetch on visit
// log + on rate-items submit so the loop closes in real time).
// ============================================================================

import { supabase } from "./supabase";
import { buildDislikeProfile, listDislikes, EMPTY_DISLIKES, type DislikeProfile } from "./dislikes";
import { foldFeedback, EMPTY_FEEDBACK, FEEDBACK_EVENTS, FEEDBACK_WINDOW_DAYS, type FeedbackLedger, type FeedbackRow } from "./recommendation/feedback";
import { isFlagEnabled } from "./flags";

/** Kill switch for the implicit-feedback loop. On unless the founder turns
 *  it off from the flags table; a network blip keeps the last value seen. */
export const FEEDBACK_LOOP_FLAG = "rec_feedback_loop";

export type PersonalSignal = {
  /** google_place_id → number of logged visits */
  visitsByPlaceId: Map<string, number>;
  /** restaurant_id → number of logged visits (same data, indexed differently) */
  visitsByRestaurantId: Map<string, number>;
  /** google_place_id → decayed, bounded implicit feedback (feedback.ts) */
  feedbackByPlaceId: FeedbackLedger;
  /** google_place_id → how the person rated their own visits there */
  placeSentimentByPlaceId: Map<string, { loved: number; ok: number; not_for_me: number }>;
  /** restaurant_id → { loved, ok, not_for_me } from menu_item_ratings.
   *  Kept for the identity/insight readers. NOT read by the scorer: it has
   *  google_place_id in hand and not restaurants.id, which is exactly why the
   *  map below exists. */
  itemSentimentByRestaurantId: Map<string, { loved: number; ok: number; not_for_me: number }>;
  /** google_place_id → { loved, ok, not_for_me } from menu_item_ratings.
   *
   *  Added 2026-09-07. Dish ratings reached the cuisine map and the
   *  restaurant_id map, and the scorer reads neither: it works in
   *  google_place_id. So rating a dish "loved" at a restaurant improved every
   *  OTHER place of that cuisine and did nothing for the one whose food you
   *  had just praised. */
  itemSentimentByPlaceId: Map<string, { loved: number; ok: number; not_for_me: number }>;
  /** cuisine_type → { loved, not_for_me } aggregated across all rated items */
  itemSentimentByCuisine: Map<string, { loved: number; not_for_me: number }>;
  /** google_place_id → number of friends who've visited */
  friendVisitsByPlaceId: Map<string, number>;
  /** "Not interested": the excluded ids and what they taught (lib/dislikes.ts). */
  dislikes: DislikeProfile;
};

const EMPTY: PersonalSignal = {
  visitsByPlaceId: new Map(),
  visitsByRestaurantId: new Map(),
  feedbackByPlaceId: EMPTY_FEEDBACK,
  placeSentimentByPlaceId: new Map(),
  itemSentimentByRestaurantId: new Map(),
  itemSentimentByPlaceId: new Map(),
  itemSentimentByCuisine: new Map(),
  friendVisitsByPlaceId: new Map(),
  dislikes: EMPTY_DISLIKES,
};

export function emptyPersonalSignal(): PersonalSignal {
  return EMPTY;
}

let cached: PersonalSignal | null = null;
let cacheUserId: string | null = null;
let inflight: Promise<PersonalSignal> | null = null;

// Listeners pattern (instead of a circular import) so the recommendation
// module can subscribe to invalidations without us importing it here.
const listeners: Array<() => void> = [];

/** Subscribe to personal-signal invalidations. Returns an unsubscribe fn. */
export function onPersonalSignalInvalidate(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** Bust the cache — call after a new visit, rating, or dismiss/skip. */
export function invalidatePersonalSignal(): void {
  cached = null;
  cacheUserId = null;
  inflight = null;
  for (const cb of listeners) {
    try { cb(); } catch { /* ignore listener errors */ }
  }
}

export async function loadPersonalSignal(): Promise<PersonalSignal> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return EMPTY;

      // The feedback window. 60 days is four half-lives of every counter
      // but save, and well inside the 180-day analytics prune, so the prune
      // never changes a weight silently.
      const since = new Date(Date.now() - FEEDBACK_WINDOW_DAYS * 86_400_000).toISOString();
      const loopOn = await isFlagEnabled(FEEDBACK_LOOP_FLAG, true);

      // Five queries in parallel — all small.
      const [visitsRes, eventsRes, itemsRes, friendsRes, friendVisitsRes] = await Promise.all([
        supabase
          .from("visits")
          .select("restaurant_id, overall_rating, visited_at, restaurant:restaurants(google_place_id, cuisine_type)")
          .eq("user_id", user.id),
        // Own rows only (0128), bounded, newest first. When the loop is
        // switched off nothing is read and the ledger stays empty, which is
        // exactly today's ranking.
        loopOn
          ? supabase
              .from("analytics_events")
              .select("event, props, created_at")
              .eq("user_id", user.id)
              .in("event", [...FEEDBACK_EVENTS])
              .gte("created_at", since)
              .order("created_at", { ascending: false })
              .limit(3000)
          : Promise.resolve({ data: [] as FeedbackRow[] }),
        supabase
          .from("menu_item_ratings")
          .select("rating, item:menu_items(restaurant_id, restaurant:restaurants(cuisine_type, google_place_id))")
          .eq("user_id", user.id),
        // The people you follow, so "somewhere your people go" can be scoped
        // to your circle. Following is the right edge here rather than mutual
        // friendship: you follow someone because you care where they eat, and
        // whether they followed back says nothing about that.
        supabase
          .from("follows")
          .select("followee_id")
          .eq("follower_id", user.id),
        Promise.resolve({ data: null }), // placeholder; we'll fill after we know friend ids
      ]);

      const sig: PersonalSignal = {
        visitsByPlaceId: new Map(),
        visitsByRestaurantId: new Map(),
        feedbackByPlaceId: EMPTY_FEEDBACK,
        placeSentimentByPlaceId: new Map(),
        itemSentimentByRestaurantId: new Map(),
  itemSentimentByPlaceId: new Map(),
        itemSentimentByCuisine: new Map(),
        friendVisitsByPlaceId: new Map(),
        dislikes: EMPTY_DISLIKES,
      };

      // "Not interested", separately: it must not take the rest of the
      // signal down with it if the table read fails.
      try {
        sig.dislikes = buildDislikeProfile(await listDislikes());
      } catch {
        // Fail open for this load (recommendations still render) but do not
        // let the failure stick: retry on the next call rather than caching
        // an empty exclusion set for the session.
        sig.dislikes = EMPTY_DISLIKES;
        setTimeout(() => invalidatePersonalSignal(), 30_000);
      }

      // Visits — both indexes, plus when you were last there, so the fold
      // can wipe the passes that preceded a visit.
      const lastVisitAt = new Map<string, number>();
      for (const row of (visitsRes.data ?? []) as any[]) {
        if (row.restaurant_id) {
          sig.visitsByRestaurantId.set(row.restaurant_id, (sig.visitsByRestaurantId.get(row.restaurant_id) ?? 0) + 1);
        }
        const r = Array.isArray(row.restaurant) ? row.restaurant[0] : row.restaurant;
        if (r?.google_place_id) {
          sig.visitsByPlaceId.set(r.google_place_id, (sig.visitsByPlaceId.get(r.google_place_id) ?? 0) + 1);
          const at = row.visited_at ? new Date(row.visited_at).getTime() : NaN;
          if (Number.isFinite(at) && at > (lastVisitAt.get(r.google_place_id) ?? -Infinity)) {
            lastVisitAt.set(r.google_place_id, at);
          }
        }
        // Overall "how was this place" reaction (visit-level) flows through the
        // SAME sentiment maps as menu-item ratings, so a loved/not-for-me visit
        // shifts recommendations for that restaurant AND its cuisine.
        const rating = row.overall_rating as "loved" | "ok" | "not_for_me" | null;
        if (rating === "loved" || rating === "ok" || rating === "not_for_me") {
          // Keyed by google_place_id, which is what the scorer has in hand.
          // The restaurant_id map below was always loaded and then skipped
          // in computePersonalDelta ("safe to skip"), so a not_for_me visit
          // never cost that place a point.
          if (r?.google_place_id) {
            const cur = sig.placeSentimentByPlaceId.get(r.google_place_id) ?? { loved: 0, ok: 0, not_for_me: 0 };
            cur[rating]++;
            sig.placeSentimentByPlaceId.set(r.google_place_id, cur);
          }
          if (row.restaurant_id) {
            const cur = sig.itemSentimentByRestaurantId.get(row.restaurant_id)
              ?? { loved: 0, ok: 0, not_for_me: 0 };
            cur[rating]++;
            sig.itemSentimentByRestaurantId.set(row.restaurant_id, cur);
          }
          // Cross-learning to cuisine: only loved/not_for_me carry signal.
          const cuisine: string | null = r?.cuisine_type ?? null;
          if (cuisine && (rating === "loved" || rating === "not_for_me")) {
            const cur = sig.itemSentimentByCuisine.get(cuisine) ?? { loved: 0, not_for_me: 0 };
            cur[rating]++;
            sig.itemSentimentByCuisine.set(cuisine, cur);
          }
        }
      }

      // The feedback ledger. One pure fold, shared with the harness.
      sig.feedbackByPlaceId = foldFeedback(
        ((eventsRes as any).data ?? []) as FeedbackRow[],
        Date.now(),
        { lastVisitAt },
      );

      // Item ratings — aggregate per restaurant + per cuisine
      for (const row of (itemsRes.data ?? []) as any[]) {
        const item = Array.isArray(row.item) ? row.item[0] : row.item;
        if (!item) continue;
        const restId: string | undefined = item.restaurant_id;
        if (restId) {
          const cur = sig.itemSentimentByRestaurantId.get(restId)
            ?? { loved: 0, ok: 0, not_for_me: 0 };
          if (row.rating === "loved") cur.loved++;
          else if (row.rating === "ok") cur.ok++;
          else if (row.rating === "not_for_me") cur.not_for_me++;
          sig.itemSentimentByRestaurantId.set(restId, cur);
        }
        const restWrap = Array.isArray(item.restaurant) ? item.restaurant[0] : item.restaurant;
        // The same counts keyed the way the scorer can actually look them up.
        const placeId: string | null = restWrap?.google_place_id ?? null;
        if (placeId) {
          const cur = sig.itemSentimentByPlaceId.get(placeId)
            ?? { loved: 0, ok: 0, not_for_me: 0 };
          if (row.rating === "loved") cur.loved++;
          else if (row.rating === "ok") cur.ok++;
          else if (row.rating === "not_for_me") cur.not_for_me++;
          sig.itemSentimentByPlaceId.set(placeId, cur);
        }
        // Cross-learning to cuisine: only loved/not_for_me carry signal (ok ≈ noise).
        const cuisine: string | null = restWrap?.cuisine_type ?? null;
        if (cuisine && (row.rating === "loved" || row.rating === "not_for_me")) {
          const cur = sig.itemSentimentByCuisine.get(cuisine) ?? { loved: 0, not_for_me: 0 };
          if (row.rating === "loved") cur.loved++;
          else cur.not_for_me++;
          sig.itemSentimentByCuisine.set(cuisine, cur);
        }
      }

      // Visits by the people you follow — loaded only if you follow anyone.
      const friendIds: string[] = [];
      for (const f of (friendsRes.data ?? []) as any[]) {
        if (f.followee_id) friendIds.push(f.followee_id);
      }
      if (friendIds.length > 0) {
        try {
          const { data: fv } = await supabase
            .from("visits")
            .select("restaurant:restaurants(google_place_id)")
            .in("user_id", friendIds);
          for (const row of (fv ?? []) as any[]) {
            const r = Array.isArray(row.restaurant) ? row.restaurant[0] : row.restaurant;
            if (r?.google_place_id) {
              sig.friendVisitsByPlaceId.set(
                r.google_place_id,
                (sig.friendVisitsByPlaceId.get(r.google_place_id) ?? 0) + 1,
              );
            }
          }
        } catch {
          // ignore — RLS may block friend visit reads in some cases
        }
      }

      cached = sig;
      cacheUserId = user.id;
      return sig;
    } catch {
      return EMPTY;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
