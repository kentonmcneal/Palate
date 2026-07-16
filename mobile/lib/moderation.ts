// ============================================================================
// moderation.ts — report content + block users (Apple Guideline 1.2 for UGC).
// ----------------------------------------------------------------------------
// Backed by supabase/migrations/0035_moderation.sql:
//   - content_reports  (insert-only for users; we triage via service role)
//   - blocked_users    (private to the blocker)
//   - block_user / unblock_user / hidden_user_ids RPCs
// ============================================================================

import { supabase } from "./supabase";

export type ReportReason = "inappropriate" | "harassment" | "spam" | "other";

export const REPORT_REASONS: { key: ReportReason; label: string }[] = [
  { key: "inappropriate", label: "Inappropriate or offensive" },
  { key: "harassment", label: "Harassment or bullying" },
  { key: "spam", label: "Spam or scam" },
  { key: "other", label: "Something else" },
];

export async function reportContent(input: {
  targetType: "feed_event" | "profile";
  targetId: string;
  targetUserId?: string | null;
  reason: ReportReason;
  note?: string | null;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in.");
  const { error } = await supabase.from("content_reports").insert({
    reporter_id: user.id,
    target_type: input.targetType,
    target_id: input.targetId,
    target_user_id: input.targetUserId ?? null,
    reason: input.reason,
    note: input.note ?? null,
  });
  if (error) throw error;
}

export async function blockUser(targetUserId: string): Promise<void> {
  const { error } = await supabase.rpc("block_user", { target: targetUserId });
  if (error) throw error;
}

export async function unblockUser(targetUserId: string): Promise<void> {
  const { error } = await supabase.rpc("unblock_user", { target: targetUserId });
  if (error) throw error;
}

export async function isBlocked(targetUserId: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("blocked_users")
    .select("blocked_id")
    .eq("blocker_id", user.id)
    .eq("blocked_id", targetUserId)
    .maybeSingle();
  return !!data;
}

/** User ids the current user should never see in the feed (blocked either way). */
export async function hiddenUserIds(): Promise<Set<string>> {
  const { data, error } = await supabase.rpc("hidden_user_ids");
  if (error || !Array.isArray(data)) return new Set();
  // A setof-uuid RPC returns scalars; be defensive about the exact shape.
  const ids = data
    .map((r: any) => (typeof r === "string" ? r : r?.hidden_user_ids ?? r?.id))
    .filter(Boolean);
  return new Set(ids as string[]);
}
