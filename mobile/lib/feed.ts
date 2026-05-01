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

export type FeedEventKind = "wrapped_shared" | "persona_change" | "milestone";

export type FeedEventPayload =
  | { kind: "wrapped_shared"; persona_label: string; tagline: string; week_start: string; week_end: string; total_visits: number; top_restaurant: string | null }
  | { kind: "persona_change"; from_persona: string | null; to_persona: string }
  | { kind: "milestone"; streak_days: number };

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

  const { data, error } = await supabase
    .from("feed_events")
    .select(`
      id, user_id, kind, payload, created_at,
      user:profiles!feed_events_user_id_fkey ( id, email, display_name, avatar_url )
    `)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const events = (data ?? []) as any[];
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
