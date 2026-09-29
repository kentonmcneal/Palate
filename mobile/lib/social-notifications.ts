// ----------------------------------------------------------------------------
// social-notifications.ts — "tell me when someone reacts to me".
// ----------------------------------------------------------------------------
// Receive preferences: profiles.push_post_likes and push_post_comments,
// both default TRUE (0148). They govern notifications addressed to this user.
// Activity notifications use push_social_activity, also default TRUE (0057,
// 0170); push_friend_activity is retired. None of these receive switches
// authorizes broadcasting the user's activity; visibility is separate.
//
// Everything here is still behind the server_push master flag, so nothing
// sends until that is turned on deliberately.
// ----------------------------------------------------------------------------
import { supabase } from "./supabase";
import { accountWriteSession, assertAccountWriteSession, requireAccountWriteUser, type AccountWriteSession } from "./account-write";

export type SocialPushPrefs = { likes: boolean; comments: boolean };

/** Legacy best-effort reader; settings must use the strict reader below. */
export async function getSocialPushPrefs(): Promise<SocialPushPrefs> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { likes: true, comments: true };
  const { data } = await supabase
    .from("profiles")
    .select("push_post_likes, push_post_comments")
    .eq("id", user.id)
    .maybeSingle();
  return {
    // A row we cannot read is not a reason to claim they are off — the switch
    // would show the opposite of the truth, which is the bug a tester just
    // found on the visibility screen.
    likes: data?.push_post_likes ?? true,
    comments: data?.push_post_comments ?? true,
  };
}

export async function setSocialPushPref(
  which: keyof SocialPushPrefs,
  enabled: boolean,
  token: AccountWriteSession = accountWriteSession(),
): Promise<void> {
  const accountId = await requireAccountWriteUser(token);
  assertAccountWriteSession(token);
  const column = which === "likes" ? "push_post_likes" : "push_post_comments";
  const { error } = await supabase
    .from("profiles")
    .update({ [column]: enabled })
    .eq("id", accountId);
  if (error) throw error;
}

/** Strict settings read; preserve getSocialPushPrefs's legacy fallback for its other consumers. */
export async function readSocialPushPref(
  which: keyof SocialPushPrefs,
  token: AccountWriteSession = accountWriteSession(),
): Promise<boolean> {
  const accountId = await requireAccountWriteUser(token);
  assertAccountWriteSession(token);
  const column = which === "likes" ? "push_post_likes" : "push_post_comments";
  const { data, error } = await supabase.from("profiles")
    .select(`id, ${column}`).eq("id", accountId).maybeSingle();
  assertAccountWriteSession(token);
  if (error) throw error;
  const value = data && column in data ? (data as Record<string, unknown>)[column] : undefined;
  if (!data || data.id !== accountId || typeof value !== "boolean") {
    throw new Error("Could not read social notification preference.");
  }
  return value;
}
