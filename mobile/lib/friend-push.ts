// ============================================================================
// friend-push.ts — the activity-push opt-in.
// ----------------------------------------------------------------------------
// One switch over all three activity events (migration 0057):
//   • someone joined      — everyone
//   • someone's Wrapped   — everyone
//   • a friend's visit    — friends only
//
// Stored on the profile, not the device, because the server decides whether to
// enqueue; a device-local flag could not stop a push already queued server-side.
//
// Default ON, because this governs what arrives on YOUR phone — a notification
// preference. What you BROADCAST is a different question and is governed by
// profile_visibility: a private profile joins quietly, its Wrapped is not
// announced, and its visits do not reach friends. Keeping those two apart is
// what lets the toggle default on without deciding anyone's privacy for them.
// ============================================================================

import { supabase } from "./supabase";

export async function isFriendActivityPushEnabled(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
      .from("profiles")
      .select("push_social_activity")
      .eq("id", user.id)
      .maybeSingle();
    return data?.push_social_activity !== false;
  } catch {
    return false;
  }
}

export async function setFriendActivityPushEnabled(on: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("profiles")
    .update({ push_social_activity: on })
    .eq("id", user.id);
}
