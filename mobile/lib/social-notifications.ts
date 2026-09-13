// ----------------------------------------------------------------------------
// social-notifications.ts — "tell me when someone reacts to me".
// ----------------------------------------------------------------------------
// Two preferences, both on profiles, both read by enqueue_social_push in 0148
// at the moment a like or comment happens. They default TRUE, unlike
// push_friend_activity which defaults FALSE — the difference is who the event
// is about. Friend activity broadcasts YOUR movements to other people, so it
// has to be opted into. A reply to you is someone addressing you, and an app
// that silently swallows those is broken rather than discreet.
//
// Everything here is still behind the server_push master flag, so nothing
// sends until that is turned on deliberately.
// ----------------------------------------------------------------------------
import { supabase } from "./supabase";

export type SocialPushPrefs = { likes: boolean; comments: boolean };

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
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in.");
  const column = which === "likes" ? "push_post_likes" : "push_post_comments";
  const { error } = await supabase
    .from("profiles")
    .update({ [column]: enabled })
    .eq("id", user.id);
  if (error) throw error;
}
