// ============================================================================
// friend-push.ts — the "a friend logged a visit" opt-in.
// ----------------------------------------------------------------------------
// Stored on the profile rather than on the device, because the server is what
// decides whether to enqueue (migration 0055's trigger reads
// profiles.push_friend_activity). A device-local flag could not stop a push
// that was already queued server-side.
//
// Default OFF, and that is a product decision, not caution: this setting is
// reciprocal in effect — turning it on means your friends' visits reach you,
// and it is the same switch that makes your own visits worth notifying about.
// Defaulting people into broadcasting where they eat is the kind of thing that
// costs trust exactly once.
// ============================================================================

import { supabase } from "./supabase";

export async function isFriendActivityPushEnabled(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
      .from("profiles")
      .select("push_friend_activity")
      .eq("id", user.id)
      .maybeSingle();
    return Boolean(data?.push_friend_activity);
  } catch {
    return false;
  }
}

export async function setFriendActivityPushEnabled(on: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("profiles")
    .update({ push_friend_activity: on })
    .eq("id", user.id);
}
