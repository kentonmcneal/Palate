// ============================================================================
// friend-push.ts — the activity-push opt-in.
// ----------------------------------------------------------------------------
// Receive preference: profiles.push_social_activity (0057, 0170).
// It gates incoming activity notifications, including follow/message paths.
// It does not grant permission to broadcast the recipient's own activity.
//
// Stored on the profile, not the device, because the server decides whether to
// enqueue. Changing it is not a guarantee that an already queued push is cancelled.
//
// Default ON, because this governs what arrives on YOUR phone — a notification
// preference. What you BROADCAST is a different question and is governed by
// profile_visibility: a private profile joins quietly, its Wrapped is not
// announced, and its visits do not reach friends. Keeping those two apart is
// what lets the toggle default on without deciding anyone's privacy for them.
// ============================================================================

import { supabase } from "./supabase";
import { accountWriteSession, assertAccountWriteSession, requireAccountWriteUser, type AccountWriteSession } from "./account-write";

/** Legacy best-effort reader; settings must use the strict reader below. */
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

export async function setFriendActivityPushEnabled(on: boolean, token: AccountWriteSession = accountWriteSession()): Promise<void> {
  const accountId = await requireAccountWriteUser(token);
  assertAccountWriteSession(token);
  const { error } = await supabase
    .from("profiles")
    .update({ push_social_activity: on })
    .eq("id", accountId);
  if (error) throw error;
}

/** Strict settings read: unknown/error is never presented as an enabled default. */
export async function readFriendActivityPushEnabled(token: AccountWriteSession = accountWriteSession()): Promise<boolean> {
  const accountId = await requireAccountWriteUser(token);
  assertAccountWriteSession(token);
  const { data, error } = await supabase.from("profiles")
    .select("id, push_social_activity").eq("id", accountId).maybeSingle();
  assertAccountWriteSession(token);
  if (error) throw error;
  if (!data || data.id !== accountId || typeof data.push_social_activity !== "boolean") {
    throw new Error("Could not read activity notification preference.");
  }
  return data.push_social_activity;
}
