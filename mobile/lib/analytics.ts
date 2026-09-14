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
//   --- passive capture (Phase 2 funnel) ---
//   perm_prescreen_shown / perm_prescreen_accepted / perm_prescreen_dismissed
//   perm_wheninuse_requested / perm_wheninuse_granted / perm_wheninuse_denied
//   perm_always_prompt_shown / perm_always_granted / perm_always_denied / perm_always_deferred
//   perm_always_revoked
//   perm_repair_banner_shown / perm_repair_tapped
//   --- passive capture (Phases 3–4 pipeline) ---
//   visit_detected / visit_qualified / visit_suppressed / visit_resolved
//   confirm_notif_sent / confirm_notif_suppressed
//   confirm_yes / confirm_no / confirm_corrected
//   inbox_opened / inbox_confirmed
// ============================================================================

import { supabase } from "./supabase";
import { captureError } from "./observability";

export async function track(
  event: string,
  props: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("analytics_events").insert({
      user_id: user?.id ?? null,
      event,
      props,
    });
    // READ THE ERROR. supabase-js `.insert()` RESOLVES with `{ error }` rather
    // than throwing, so the catch below can never fire on a rejected write and
    // ignoring the return value makes an RLS regression completely silent.
    //
    // That is exactly what happened: migration 0110 narrowed the INSERT policy
    // to `authenticated`, and every pre-sign-in event — the whole top of the
    // funnel, where the app loses the most people — was discarded for eight
    // days with nothing anywhere reporting it. "Wrap it in a catch and log"
    // would not have surfaced this, because there was nothing to catch.
    if (error) {
      // Not thrown: analytics must never block UX. But it reaches Sentry, so
      // the next time a policy change silently drops events, somebody knows.
      captureError(new Error(`analytics insert rejected: ${error.message}`), {
        at: "track", event,
      });
    }
  } catch {
    // Silent — analytics must never block UX.
  }
}
