// ============================================================================
// messages.ts — direct messages, between friends.
// ----------------------------------------------------------------------------
// WHO CAN MESSAGE WHOM was the load-bearing decision and it is answered from
// this app's own graph. 0116 made follows unilateral on purpose: one tap, and
// the followee is never asked. So a follow row records the FOLLOWER's intent
// and nothing about the followee — "message anyone you follow" would mean
// "anyone may message anyone, one tap away".
//
// The only edge that required consent from both people is a mutual follow.
// 0120 exists because 0116 treated a one-way follower as a friend in three
// places, one of which handed a stranger somebody's visit history. Same lesson,
// applied rather than relearned.
//
// Enforced at SEND time inside dm_send (0130) — never here. Everything in this
// file is a convenience for the UI; none of it is the permission.
// ============================================================================

import { supabase } from "./supabase";

export type DmThread = {
  thread_id: string;
  other_id: string;
  other_name: string | null;
  other_username: string | null;
  other_avatar: string | null;
  last_preview: string | null;
  last_message_at: string | null;
  last_sender_id: string | null;
  unread: number;
};

export type DmMessage = {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export async function listThreads(): Promise<DmThread[]> {
  const { data, error } = await supabase.rpc("dm_threads_list");
  if (error) throw error;
  return (data ?? []) as DmThread[];
}

export async function unreadTotal(): Promise<number> {
  const { data, error } = await supabase.rpc("dm_unread_total");
  if (error) return 0;
  return (data as number) ?? 0;
}

/** Oldest-first, which is the order a conversation is read in. */
export async function listMessages(threadId: string, limit = 200): Promise<DmMessage[]> {
  const { data, error } = await supabase
    .from("dm_messages")
    .select("id, thread_id, sender_id, body, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as DmMessage[]).reverse();
}

/** Returns the new message id. Throws with the server's own reason — the
 *  permission message is written to be shown to a person. */
export async function sendMessage(toUserId: string, body: string): Promise<string> {
  const { data, error } = await supabase.rpc("dm_send", { p_to: toUserId, p_body: body });
  if (error) throw error;
  return data as string;
}

export async function markRead(threadId: string): Promise<void> {
  await supabase.rpc("dm_mark_read", { p_thread: threadId }).then(() => {}, () => {});
}

/**
 * Live messages for one open thread.
 *
 * Realtime respects RLS, and the select policy on dm_messages is
 * participant-only, so a subscription cannot deliver somebody else's
 * conversation even if the filter were wrong. The filter is still there
 * because a subscription that receives every message in the system and
 * discards most of them is a waste of the free tier's budget.
 *
 * Returns an unsubscribe. Callers must call it: an orphaned channel holds a
 * socket open for the life of the app.
 */
export function subscribeToThread(
  threadId: string,
  onMessage: (m: DmMessage) => void,
): () => void {
  const channel = supabase
    .channel(`dm:${threadId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "dm_messages", filter: `thread_id=eq.${threadId}` },
      (payload) => onMessage(payload.new as DmMessage),
    )
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
