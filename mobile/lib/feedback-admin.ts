// ============================================================================
// feedback-admin.ts — reading what testers reported.
// ----------------------------------------------------------------------------
// The push in notify-feedback is the fast route and it can fail: no token, a
// device that revoked notifications, Expo down. This is the route that cannot.
// Both are admin-gated definer RPCs (0125); `feedback` never gains a select
// policy, because its rows carry free text somebody wrote in confidence.
// ============================================================================

import { supabase } from "./supabase";

export type FeedbackRow = {
  id: string;
  category: string;
  message: string;
  status: string;
  app_version: string | null;
  platform: string | null;
  device: string | null;
  screenshot_path: string | null;
  created_at: string;
  reporter: string | null;
};

export async function feedbackUnreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc("feedback_unread_count");
  if (error) return 0;
  return (data as number) ?? 0;
}

export async function listFeedback(limit = 50): Promise<FeedbackRow[]> {
  const { data, error } = await supabase.rpc("list_feedback", { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as FeedbackRow[];
}

export async function markFeedbackTriaged(id: string): Promise<void> {
  const { error } = await supabase.rpc("mark_feedback_triaged", { p_id: id });
  if (error) throw error;
}

/** A signed URL for a report's screenshot, or null. The bucket is private. */
export async function feedbackScreenshotUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("feedback")
    .createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data?.signedUrl ?? null;
}
