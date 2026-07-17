// ============================================================================
// referrals.ts — invite link generation + referral claim.
// ----------------------------------------------------------------------------
// The mobile app's Share button generates a URL like
//   https://palate-zm29.vercel.app/?ref=<userId>
// which lands on the marketing site; when the new user signs up in the app
// (and the deep-link / clipboard contained the ref), we call recordReferral().
//
// NOTE: points at the live Vercel URL because palate.app isn't attached to the
// deployment yet — palate.app/... resolves to nothing. Flip this back to
// https://palate.app/ once the custom domain is live (and its AASA file is up
// for the applinks:palate.app universal-link claim in app.json).
// ============================================================================

import { supabase } from "./supabase";

export const INVITE_BASE_URL = "https://palate-zm29.vercel.app/";

export async function generateInviteLink(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return INVITE_BASE_URL;
  return `${INVITE_BASE_URL}?ref=${user.id}`;
}

export function inviteShareMessage(link: string): string {
  return [
    "I've been tracking everywhere I eat on Palate — it figures out your taste identity from your actual habits, not star ratings.",
    "Add me and we can see how our palates compare 👀",
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
