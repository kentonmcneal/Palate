// ============================================================================
// recommendation-events.ts — TikTok-style feedback loop tracking.
// ----------------------------------------------------------------------------
// Every interaction with a restaurant — viewed, clicked, saved, skipped,
// dismissed, shared — is fired through here, gets a signed weight, and
// inserts an analytics event AND optionally a `prompt_decisions` row.
//
// The taste vector reads from these events via the visit + wishlist
// rollups already in place. Adding new event kinds is additive — we
// store the kind + weight in `analytics_events.props` and any future
// scorer can read them.
//
// Event kind → signed weight (default; callers can override):
//   restaurant_visited        +5  (highest signal)
//   restaurant_repeated       +4
//   restaurant_saved          +3
//   restaurant_shared         +3
//   stretch_pick_clicked      +2
//   restaurant_clicked        +1
//   restaurant_viewed          0  (impression only — no weight)
//   restaurant_skipped        -1
//   recommendation_dismissed  -2
// ============================================================================

import { track } from "./analytics";
import { supabase } from "./supabase";

export type RecEventKind =
  | "restaurant_viewed"
  | "restaurant_clicked"
  | "restaurant_saved"
  | "restaurant_skipped"
  | "restaurant_visited"
  | "restaurant_repeated"
  | "restaurant_shared"
  | "recommendation_dismissed"
  | "stretch_pick_clicked"
  | "wishlist_added";

export const REC_EVENT_WEIGHT: Record<RecEventKind, number> = {
  restaurant_viewed: 0,
  restaurant_clicked: 1,
  restaurant_saved: 3,
  restaurant_skipped: -1,
  restaurant_visited: 5,
  restaurant_repeated: 4,
  restaurant_shared: 3,
  recommendation_dismissed: -2,
  stretch_pick_clicked: 2,
  wishlist_added: 3,
};

export type RecEventContext = {
  /** Where the interaction happened — discover/feed/recommendations/etc. */
  surface?: "home_recs" | "discover_for_you" | "discover_shelf" | "discover_map" | "wishlist" | "feed" | "search";
  /** What the engine thought the match score was (for offline replay). */
  matchScore?: number;
  /** Was this rec served as a stretch pick? */
  bucket?: "safe" | "stretch" | "aspirational" | "trending" | "friends" | null;
  /** Anything else worth keeping. */
  [k: string]: unknown;
};

/**
 * Fire-and-forget event tracker. Writes to `analytics_events` + bumps the
 * recommendation feedback signal. Never throws into UX.
 */
export async function trackRecEvent(
  kind: RecEventKind,
  googlePlaceId: string,
  context: RecEventContext = {},
): Promise<void> {
  try {
    const weight = REC_EVENT_WEIGHT[kind] ?? 0;
    await track(`rec_${kind}`, {
      google_place_id: googlePlaceId,
      weight,
      ...context,
    });

    // Negative-signal events also write to prompt_decisions so the existing
    // skip-nudge surface picks them up.
    if (kind === "restaurant_skipped" || kind === "recommendation_dismissed") {
      const outcome = kind === "recommendation_dismissed" ? "dismissed" : "dismissed";
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("prompt_decisions").insert({
          user_id: user.id,
          google_place_id: googlePlaceId,
          outcome,
        });
      }
    }
  } catch {
    // Silent — analytics never block UX.
  }
}

/**
 * Batch impression tracker. Use when surfacing a list — fires viewed events
 * for everything visible so the feedback loop knows what was shown vs picked.
 */
export async function trackImpressions(
  placeIds: string[],
  context: RecEventContext = {},
): Promise<void> {
  for (const id of placeIds) {
    void trackRecEvent("restaurant_viewed", id, context);
  }
}

/** Pull aggregated rec-event counts per restaurant for a single user. Useful
 *  for the ranker to penalize already-dismissed places. */
export async function loadUserRecCounters(
  googlePlaceIds: string[],
): Promise<Record<string, { saves: number; skips: number; dismisses: number; clicks: number }>> {
  const out: Record<string, { saves: number; skips: number; dismisses: number; clicks: number }> = {};
  if (googlePlaceIds.length === 0) return out;
  try {
    const { data } = await supabase
      .from("analytics_events")
      .select("event, props")
      .in("event", [
        "rec_restaurant_saved",
        "rec_restaurant_skipped",
        "rec_recommendation_dismissed",
        "rec_restaurant_clicked",
      ]);
    for (const row of (data ?? []) as Array<{ event: string; props: any }>) {
      const id = row.props?.google_place_id;
      if (!id || !googlePlaceIds.includes(id)) continue;
      if (!out[id]) out[id] = { saves: 0, skips: 0, dismisses: 0, clicks: 0 };
      if (row.event === "rec_restaurant_saved") out[id].saves++;
      else if (row.event === "rec_restaurant_skipped") out[id].skips++;
      else if (row.event === "rec_recommendation_dismissed") out[id].dismisses++;
      else if (row.event === "rec_restaurant_clicked") out[id].clicks++;
    }
  } catch {
    // ignore
  }
  return out;
}
