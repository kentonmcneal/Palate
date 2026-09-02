// ============================================================================
// feed.ts — friends' feed events + likes.
// ----------------------------------------------------------------------------
// Events you can see (governed by RLS in 0007_social_layer.sql):
//   - your own
//   - your friends' (when their visibility is 'friends' or 'public')
//
// Event kinds:
//   wrapped_shared  — user explicitly shared their weekly Wrapped to feed
//   persona_change  — user's persona changed week over week (auto)
//   milestone       — streak milestone reached (auto)
// ============================================================================

import { supabase } from "./supabase";
import { hiddenUserIds } from "./moderation";

export type FeedEventKind = "wrapped_shared" | "persona_change" | "milestone" | "visit_logged";

export type FeedEventPayload =
  | { kind: "wrapped_shared"; persona_label: string; tagline: string; week_start: string; week_end: string; total_visits: number; top_restaurant: string | null; top_restaurant_place_id?: string | null }
  | { kind: "persona_change"; from_persona: string | null; to_persona: string }
  | { kind: "milestone"; streak_days: number }
  | { kind: "visit_logged"; restaurant_name: string; cuisine: string | null; neighborhood: string | null; google_place_id?: string };

export type FeedEvent = {
  id: string;
  user_id: string;
  kind: FeedEventKind;
  payload: any; // type depends on kind; cast at consumer
  created_at: string;
  /** Joined profile of the user. */
  user: {
    id: string;
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  /** True if current user has liked this event. */
  iLiked: boolean;
  likeCount: number;
};

async function currentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Fetch up to `limit` recent feed events visible to the current user. */
export async function listFeed(limit = 50): Promise<FeedEvent[]> {
  const me = await currentUserId();
  if (!me) return [];

  const [{ data, error }, hidden] = await Promise.all([
    supabase
      .from("feed_events")
      .select(`
        id, user_id, kind, payload, created_at,
        user:profiles!feed_events_user_id_fkey ( id, email, display_name, avatar_url )
      `)
      .order("created_at", { ascending: false })
      .limit(limit),
    hiddenUserIds(),
  ]);
  if (error) throw error;
  // Drop posts from anyone blocked (either direction) before anything else.
  const events = ((data ?? []) as any[]).filter((e) => !hidden.has(e.user_id));
  if (!events.length) return [];

  // Bulk-load like counts + my likes so we don't N+1
  const ids = events.map((e) => e.id);
  const [{ data: likeRows }, { data: myLikeRows }] = await Promise.all([
    supabase.from("feed_likes").select("feed_event_id").in("feed_event_id", ids),
    supabase.from("feed_likes").select("feed_event_id").eq("user_id", me).in("feed_event_id", ids),
  ]);
  const likeCounts = new Map<string, number>();
  for (const r of (likeRows ?? []) as Array<{ feed_event_id: string }>) {
    likeCounts.set(r.feed_event_id, (likeCounts.get(r.feed_event_id) ?? 0) + 1);
  }
  const myLikes = new Set<string>(
    ((myLikeRows ?? []) as Array<{ feed_event_id: string }>).map((r) => r.feed_event_id),
  );

  return events.map((e) => ({
    id: e.id,
    user_id: e.user_id,
    kind: e.kind as FeedEventKind,
    payload: e.payload,
    created_at: e.created_at,
    user: e.user,
    iLiked: myLikes.has(e.id),
    likeCount: likeCounts.get(e.id) ?? 0,
  }));
}

// ----------------------------------------------------------------------------
// Posting events
// ----------------------------------------------------------------------------

export async function shareWrappedToFeed(opts: {
  personaLabel: string;
  tagline: string;
  weekStart: string;
  weekEnd: string;
  totalVisits: number;
  topRestaurant: string | null;
}): Promise<void> {
  const me = await currentUserId();
  if (!me) throw new Error("Not signed in");

  // Resolve the top restaurant to a place id so the name in the feed is
  // tappable. Done HERE rather than in generate_weekly_wrapped because the
  // poster is reading their own visits — no permission widening, and no
  // rewrite of a service-role function that a cron depends on.
  //
  // Null when the name maps to more than one place: top_restaurant groups by
  // coalesce(chain_name, name), so a chain visited at two locations has no
  // single destination, and guessing one would send people somewhere the
  // post did not mean.
  const topPlaceId = opts.topRestaurant
    ? await resolveTopPlaceId(me, opts.weekStart, opts.weekEnd, opts.topRestaurant)
    : null;

  const { data, error } = await supabase.from("feed_events").insert({
    user_id: me,
    kind: "wrapped_shared",
    payload: {
      persona_label: opts.personaLabel,
      tagline: opts.tagline,
      week_start: opts.weekStart,
      week_end: opts.weekEnd,
      total_visits: opts.totalVisits,
      top_restaurant: opts.topRestaurant,
      top_restaurant_place_id: topPlaceId,
    },
  }).select("id").single();
  if (error) throw error;

  // Fire-and-forget push notification fanout. Failures don't block the share.
  void supabase.functions.invoke("notify-feed-post", {
    body: { feed_event_id: data.id },
  });
}

export async function postMilestoneAndNotify(streakDays: number): Promise<void> {
  const me = await currentUserId();
  if (!me) throw new Error("Not signed in");
  const { data, error } = await supabase.from("feed_events").insert({
    user_id: me,
    kind: "milestone",
    payload: { streak_days: streakDays },
  }).select("id").single();
  if (error) throw error;
  void supabase.functions.invoke("notify-feed-post", {
    body: { feed_event_id: data.id },
  });
}

export async function postMilestone(streakDays: number): Promise<void> {
  const me = await currentUserId();
  if (!me) throw new Error("Not signed in");
  const { error } = await supabase.from("feed_events").insert({
    user_id: me,
    kind: "milestone",
    payload: { streak_days: streakDays },
  });
  if (error) throw error;
}

// ----------------------------------------------------------------------------
// Likes
// ----------------------------------------------------------------------------

export async function toggleLike(eventId: string, currentlyLiked: boolean): Promise<void> {
  const me = await currentUserId();
  if (!me) throw new Error("Not signed in");
  if (currentlyLiked) {
    const { error } = await supabase
      .from("feed_likes")
      .delete()
      .eq("feed_event_id", eventId)
      .eq("user_id", me);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("feed_likes")
      .insert({ feed_event_id: eventId, user_id: me });
    if (error && !`${error.message}`.includes("duplicate")) throw error;
  }
}

/**
 * The google_place_id behind a Wrapped's top_restaurant, or null when there
 * isn't exactly one. Reads only the poster's own visits.
 */
async function resolveTopPlaceId(
  userId: string,
  weekStart: string,
  weekEnd: string,
  topName: string,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("visits")
      .select("restaurant:restaurants(google_place_id, name, chain_name)")
      .eq("user_id", userId)
      .gte("visited_at", `${weekStart}T00:00:00Z`)
      .lte("visited_at", `${weekEnd}T23:59:59Z`);

    type Row = { restaurant: { google_place_id: string; name: string; chain_name: string | null }
      | { google_place_id: string; name: string; chain_name: string | null }[] | null };

    const ids = new Set<string>();
    for (const row of (data ?? []) as Row[]) {
      const r = Array.isArray(row.restaurant) ? row.restaurant[0] : row.restaurant;
      if (!r) continue;
      // Match the SQL function's grouping key exactly, or we would resolve a
      // different "top" than the one the post displays.
      if ((r.chain_name ?? r.name) === topName) ids.add(r.google_place_id);
    }
    return ids.size === 1 ? [...ids][0] : null;
  } catch {
    return null;
  }
}
