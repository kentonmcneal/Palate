// ============================================================================
// referrals.ts — invite link generation + referral claim.
// ----------------------------------------------------------------------------
// The mobile app's Share button generates a URL like
//   https://palate.app/?ref=<userId>
// which lands on the marketing site; when the new user signs up in the app
// (and the deep-link / clipboard contained the ref), we call recordReferral().
// ============================================================================

import { supabase } from "./supabase";

export const INVITE_BASE_URL = "https://palate.app/";

export async function generateInviteLink(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return INVITE_BASE_URL;
  return `${INVITE_BASE_URL}?ref=${user.id}`;
}

export function inviteShareMessage(link: string): string {
  return [
    "I've been using Palate — it tells you what your eating habits actually say about you. Patterns, not ratings.",
    "",
    `Try it: ${link}`,
  ].join("\n");
}

/** Record an invite credit for the user who shared the link. Idempotent. */
export async function recordReferral(inviterId: string): Promise<void> {
  if (!inviterId) return;
  await supabase.rpc("record_referral", { p_inviter_id: inviterId, p_source: "share_link" });
}

export async function getMyReferralCount(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { data } = await supabase
    .from("my_referral_stats")
    .select("invitee_count")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data?.invitee_count as number | undefined) ?? 0;
}
