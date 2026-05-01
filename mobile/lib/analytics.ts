// ============================================================================
// analytics.ts — fire-and-forget event tracking to Supabase.
// ----------------------------------------------------------------------------
// Wraps a single insert into analytics_events. Always non-blocking — failures
// are swallowed so a network blip never breaks UX.
//
// Usage:
//   track("visit_logged", { source: "manual", visit_total: 3 });
//
// Supported events (keep this list in sync with what's actually fired):
//   sign_in_started
//   sign_in_verified
//   onboarding_started
//   profile_setup_completed
//   quiz_started
//   quiz_completed         { persona }
//   taste_prefs_completed
//   permission_granted     { kind: "foreground" | "background" }
//   permission_denied      { kind }
//   onboarding_finished
//   visit_logged           { source: "auto"|"manual", visit_total }
//   wishlist_saved         { source }
//   wishlist_tagged        { tag_count }
//   wrapped_generated
//   wrapped_posted_to_feed
//   friend_requested
//   friend_accepted
//   feed_liked
//   maps_opened
// ============================================================================

import { supabase } from "./supabase";

export async function track(
  event: string,
  props: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("analytics_events").insert({
      user_id: user?.id ?? null,
      event,
      props,
    });
  } catch {
    // Silent — analytics must never block UX.
  }
}
