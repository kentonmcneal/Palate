// ----------------------------------------------------------------------------
// feed-comments.ts — replies under a feed post.
// ----------------------------------------------------------------------------
// Reads go through list_feed_comments, never a PostgREST embed. `profiles` is
// own-row RLS: an embed returns null for every author but yourself, which is
// exactly the bug that made the feed render nameless before 0077. The RPC is
// the sanctioned way past that, and it returns only the columns it means to —
// no email (0036 removed it from search to stop address enumeration).
//
// Writes are a plain insert. The policy in 0146 is the check: you may only
// write as yourself, only under a post you can actually see, and never across
// a block. Nothing here re-implements that in TypeScript.
// ----------------------------------------------------------------------------
import { supabase } from "./supabase";

/** Matches the CHECK constraint in 0146. The server is the one that counts. */
export const COMMENT_MAX_LENGTH = 500;

export type FeedComment = {
  id: string;
  feedEventId: string;
  userId: string;
  body: string;
  createdAt: string;
  author: {
    displayName: string | null;
    username: string | null;
    avatarUrl: string | null;
  };
  /** True for your own comments AND for anything under a post you authored. */
  canDelete: boolean;
};

export async function listComments(eventId: string, limit = 100): Promise<FeedComment[]> {
  const { data, error } = await supabase.rpc("list_feed_comments", {
    p_event_id: eventId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []).map((c: any) => ({
    id: c.id,
    feedEventId: c.feed_event_id,
    userId: c.user_id,
    body: c.body,
    createdAt: c.created_at,
    author: {
      displayName: c.author_display_name ?? null,
      username: c.author_username ?? null,
      avatarUrl: c.author_avatar_url ?? null,
    },
    canDelete: Boolean(c.can_delete),
  }));
}

/** Returns the created comment so the caller can render it without a refetch. */
export async function addComment(eventId: string, body: string): Promise<FeedComment> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Say something first.");
  if (trimmed.length > COMMENT_MAX_LENGTH) {
    throw new Error(`Keep it under ${COMMENT_MAX_LENGTH} characters.`);
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in.");

  const { data, error } = await supabase
    .from("feed_comments")
    .insert({ feed_event_id: eventId, user_id: user.id, body: trimmed })
    .select("id, feed_event_id, user_id, body, created_at")
    .single();
  if (error) throw error;

  // The insert cannot return the author profile (own-row RLS again), and the
  // one profile this client can always read is its own — which is whose
  // comment this is.
  const { data: me } = await supabase
    .from("profiles")
    .select("display_name, username, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: data.id,
    feedEventId: data.feed_event_id,
    userId: data.user_id,
    body: data.body,
    createdAt: data.created_at,
    author: {
      displayName: me?.display_name ?? null,
      username: me?.username ?? null,
      avatarUrl: me?.avatar_url ?? null,
    },
    canDelete: true,
  };
}

/**
 * Delete a comment. The DELETE policy allows the comment's author or the
 * author of the post; anyone else silently affects zero rows rather than
 * erroring, so this reports whether anything actually went.
 */
export async function deleteComment(commentId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("feed_comments")
    .delete()
    .eq("id", commentId)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
