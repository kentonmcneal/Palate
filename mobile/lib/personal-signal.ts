// ============================================================================
// personal-signal.ts — the user-specific layer that the scorers consume.
// ----------------------------------------------------------------------------
// Pulls everything personal in one round-trip:
//   • visit counts per place (anti-staleness penalty)
//   • dismiss / skip counters (negative signal)
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

export type PersonalSignal = {
  /** google_place_id → number of logged visits */
  visitsByPlaceId: Map<string, number>;
  /** restaurant_id → number of logged visits (same data, indexed differently) */
  visitsByRestaurantId: Map<string, number>;
  /** google_place_id → dismiss + skip counts */
  dismissesByPlaceId: Map<string, number>;
  skipsByPlaceId: Map<string, number>;
  /** restaurant_id → { loved, ok, not_for_me } from menu_item_ratings */
  itemSentimentByRestaurantId: Map<string, { loved: number; ok: number; not_for_me: number }>;
  /** cuisine_type → { loved, not_for_me } aggregated across all rated items */
  itemSentimentByCuisine: Map<string, { loved: number; not_for_me: number }>;
  /** google_place_id → number of friends who've visited */
  friendVisitsByPlaceId: Map<string, number>;
};

const EMPTY: PersonalSignal = {
  visitsByPlaceId: new Map(),
  visitsByRestaurantId: new Map(),
  dismissesByPlaceId: new Map(),
  skipsByPlaceId: new Map(),
  itemSentimentByRestaurantId: new Map(),
  itemSentimentByCuisine: new Map(),
  friendVisitsByPlaceId: new Map(),
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

      // Five queries in parallel — all small.
      const [visitsRes, eventsRes, itemsRes, friendsRes, friendVisitsRes] = await Promise.all([
        supabase
          .from("visits")
          .select("restaurant_id, restaurant:restaurants(google_place_id)")
          .eq("user_id", user.id),
        supabase
          .from("analytics_events")
          .select("event, props")
          .eq("user_id", user.id)
          .in("event", ["rec_restaurant_skipped", "rec_recommendation_dismissed"]),
        supabase
          .from("menu_item_ratings")
          .select("rating, item:menu_items(restaurant_id, restaurant:restaurants(cuisine_type))")
          .eq("user_id", user.id),
        // Pull friends so we can scope friend-visit queries to this user's circle.
        supabase
          .from("friendships")
          .select("requester_id, addressee_id")
          .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
          .eq("status", "accepted"),
        Promise.resolve({ data: null }), // placeholder; we'll fill after we know friend ids
      ]);

      const sig: PersonalSignal = {
        visitsByPlaceId: new Map(),
        visitsByRestaurantId: new Map(),
        dismissesByPlaceId: new Map(),
        skipsByPlaceId: new Map(),
        itemSentimentByRestaurantId: new Map(),
        itemSentimentByCuisine: new Map(),
        friendVisitsByPlaceId: new Map(),
      };

      // Visits — both indexes
      for (const row of (visitsRes.data ?? []) as any[]) {
        if (row.restaurant_id) {
          sig.visitsByRestaurantId.set(row.restaurant_id, (sig.visitsByRestaurantId.get(row.restaurant_id) ?? 0) + 1);
        }
        const r = Array.isArray(row.restaurant) ? row.restaurant[0] : row.restaurant;
        if (r?.google_place_id) {
          sig.visitsByPlaceId.set(r.google_place_id, (sig.visitsByPlaceId.get(r.google_place_id) ?? 0) + 1);
        }
      }

      // Dismiss + skip counters from analytics_events
      for (const row of (eventsRes.data ?? []) as any[]) {
        const id = row.props?.google_place_id;
        if (!id) continue;
        if (row.event === "rec_recommendation_dismissed") {
          sig.dismissesByPlaceId.set(id, (sig.dismissesByPlaceId.get(id) ?? 0) + 1);
        } else if (row.event === "rec_restaurant_skipped") {
          sig.skipsByPlaceId.set(id, (sig.skipsByPlaceId.get(id) ?? 0) + 1);
        }
      }

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
        // Cross-learning to cuisine: only loved/not_for_me carry signal (ok ≈ noise).
        const restWrap = Array.isArray(item.restaurant) ? item.restaurant[0] : item.restaurant;
        const cuisine: string | null = restWrap?.cuisine_type ?? null;
        if (cuisine && (row.rating === "loved" || row.rating === "not_for_me")) {
          const cur = sig.itemSentimentByCuisine.get(cuisine) ?? { loved: 0, not_for_me: 0 };
          if (row.rating === "loved") cur.loved++;
          else cur.not_for_me++;
          sig.itemSentimentByCuisine.set(cuisine, cur);
        }
      }

      // Friend visits — load only if user has friends
      const friendIds: string[] = [];
      for (const f of (friendsRes.data ?? []) as any[]) {
        const otherId = f.requester_id === user.id ? f.addressee_id : f.requester_id;
        if (otherId) friendIds.push(otherId);
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

// ============================================================================
// Penalty / boost computation — pure functions the scorers call once per
// candidate. Bounded so a single signal can't dominate the composite.
// ============================================================================

const STALE_VISITS_FREE = 2;       // first 2 visits don't penalize
const STALE_PER_VISIT = 4;         // -4 per extra visit
const STALE_CAP = 16;
const DISMISS_PER_EVENT = 6;
const DISMISS_CAP = 18;
const SKIP_PER_EVENT = 3;
const SKIP_CAP = 9;
const ITEM_LOVED_PER = 4;
const ITEM_NOT_FOR_ME_PER = 5;
const ITEM_REST_CAP = 14;
const FRIEND_PER = 2;
const FRIEND_CAP = 6;
const CUISINE_BOOST_PER_NET = 2;
const CUISINE_BOOST_CAP = 8;

export type PersonalAdjustment = {
  delta: number;       // signed points to add to a 0..100 match score
  notes: string[];     // human-readable, optional UX surface ("3 friends visited")
};

/**
 * Computes the personal adjustment for one candidate restaurant. Caller
 * adds `delta` to the base score, then re-clamps to [0, 100].
 */
export function personalAdjustment(opts: {
  signal: PersonalSignal;
  googlePlaceId: string;
  restaurantId?: string | null;
  cuisineType?: string | null;
  /** When true (Home recs feed), apply anti-staleness. Disabled on detail
   *  pages, restaurant search, or favorites where the user wants their
   *  known spots. */
  applyStaleness?: boolean;
}): PersonalAdjustment {
  const notes: string[] = [];
  let delta = 0;

  // Anti-staleness — penalize over-visited spots in the recs feed only.
  if (opts.applyStaleness) {
    const visits = opts.signal.visitsByPlaceId.get(opts.googlePlaceId) ?? 0;
    const over = Math.max(0, visits - STALE_VISITS_FREE);
    if (over > 0) {
      const pen = Math.min(STALE_CAP, over * STALE_PER_VISIT);
      delta -= pen;
      notes.push(`${visits} visits — easing up`);
    }
  }

  // Negative signals: dismissals + skips
  const dismisses = opts.signal.dismissesByPlaceId.get(opts.googlePlaceId) ?? 0;
  if (dismisses > 0) {
    delta -= Math.min(DISMISS_CAP, dismisses * DISMISS_PER_EVENT);
  }
  const skips = opts.signal.skipsByPlaceId.get(opts.googlePlaceId) ?? 0;
  if (skips > 0) {
    delta -= Math.min(SKIP_CAP, skips * SKIP_PER_EVENT);
  }

  // Item-level sentiment at this restaurant
  if (opts.restaurantId) {
    const s = opts.signal.itemSentimentByRestaurantId.get(opts.restaurantId);
    if (s) {
      const itemDelta = (s.loved * ITEM_LOVED_PER) - (s.not_for_me * ITEM_NOT_FOR_ME_PER);
      const clamped = Math.max(-ITEM_REST_CAP, Math.min(ITEM_REST_CAP, itemDelta));
      delta += clamped;
      if (s.loved >= 2) notes.push(`you loved ${s.loved} items here`);
      else if (s.not_for_me >= 2) notes.push(`${s.not_for_me} items weren't for you`);
    }
  }

  // Item↔cuisine cross-learning — if you've loved hummus across multiple
  // Mediterranean spots, every unseen Mediterranean spot gets a small lift.
  if (opts.cuisineType) {
    const c = opts.signal.itemSentimentByCuisine.get(opts.cuisineType);
    if (c) {
      const net = c.loved - c.not_for_me;
      if (net !== 0) {
        const cuisineDelta = Math.max(
          -CUISINE_BOOST_CAP,
          Math.min(CUISINE_BOOST_CAP, net * CUISINE_BOOST_PER_NET),
        );
        delta += cuisineDelta;
      }
    }
  }

  // Friend social proof
  const friends = opts.signal.friendVisitsByPlaceId.get(opts.googlePlaceId) ?? 0;
  if (friends > 0) {
    delta += Math.min(FRIEND_CAP, friends * FRIEND_PER);
    notes.push(`${friends} friend${friends === 1 ? "" : "s"} visited`);
  }

  return { delta, notes };
}

// ============================================================================
// Time-of-day context boost — small adjustment based on whether the
// restaurant's occasion tags align with right-now. Used on the simple
// match-score so cards reflect "good for THIS hour" as well as overall fit.
// ============================================================================

export function timeOfDayBoost(occasionTags: string[] | null | undefined, now = new Date()): number {
  if (!occasionTags || occasionTags.length === 0) return 0;
  const hour = now.getHours();
  const dow = now.getDay();
  const isWeekend = dow === 0 || dow === 6;

  // Resolve current "slot"
  let slot: "breakfast" | "brunch" | "lunch" | "dinner" | "late_night";
  if (hour < 10) slot = "breakfast";
  else if (hour < 13 && isWeekend) slot = "brunch";
  else if (hour < 15) slot = "lunch";
  else if (hour < 22) slot = "dinner";
  else slot = "late_night";

  const matchMap: Record<string, string[]> = {
    breakfast: ["breakfast", "brunch"],
    brunch: ["brunch", "breakfast"],
    lunch: ["working_lunch", "casual_solo"],
    dinner: ["date_night", "group_dinner", "casual_solo"],
    late_night: ["late_night"],
  };
  const wanted = matchMap[slot] ?? [];
  const hits = occasionTags.filter((t) => wanted.includes(t)).length;
  if (hits === 0) return 0;
  // Soft bonus — never enough to dominate the base match score.
  return Math.min(6, hits * 3);
}
