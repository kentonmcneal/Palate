// ============================================================================
// recommendation-events.ts — what the ranker is allowed to learn from.
// ----------------------------------------------------------------------------
// Every gesture on a recommended place goes through here and lands in
// analytics_events as `rec_<kind>`, carrying enough context to be attributed
// later: which surface, which ranking pass (request_id), which slot in that
// pass (rank), whether it was the explore slot, and the scores the ranker
// gave it at the time. lib/recommendation/feedback.ts folds those rows back
// into the ranking; supabase rec_funnel() reads them in aggregate.
//
// What this file used to be: a table of "signed weights" written into props
// and read by nothing, an impression tracker that fired for the whole list
// the moment the data loaded, and a cross-write into prompt_decisions that
// made a "Not interested" tap suppress the passive-capture prompt for that
// place for six hours. None of that survives.
//
// Kinds, and what each one is evidence of:
//   restaurant_viewed         the card was at least half on screen for half a
//                             second (components/Impressions.tsx). The
//                             denominator, and on its own a small negative
//                             once nothing follows it in the same session.
//   restaurant_clicked        opened the detail page from a rec surface
//   restaurant_saved          saved to the wishlist from a rec surface
//   maps_opened               asked for directions — the strongest intent
//                             short of going
//   try_another               passed on the hero pick
//   recommendation_dismissed  "Not interested" (the place is also excluded
//                             outright via place_dislikes; this is the record)
//   stretch_pick_clicked      opened the Discover stretch pick
// ============================================================================

import { AppState } from "react-native";
import { track } from "./analytics";

export type RecEventKind =
  | "restaurant_viewed"
  | "restaurant_clicked"
  | "restaurant_saved"
  | "maps_opened"
  | "try_another"
  | "recommendation_dismissed"
  | "stretch_pick_clicked";

export type RecSurface =
  | "home_recs" | "home_hero" | "home_stretch"
  | "discover_for_you" | "discover_stretch" | "discover_shelf" | "discover_map"
  | "wishlist" | "feed" | "search" | "featured" | "detail" | "digest" | "gate";

export type RecEventContext = {
  /** Where the interaction happened. */
  surface?: RecSurface;
  /** One id per ranking pass, so "shown together" is recoverable. */
  request_id?: string;
  /** 0-based position in the list the user saw. */
  rank?: number;
  /** The explore slot is a deliberate step outside the pattern; its outcomes
   *  are read separately so exploration can be judged on its own results. */
  slot?: "exploit" | "explore";
  /** The headline % the card showed. */
  matchScore?: number;
  /** What the list was actually ordered by. */
  finalScore?: number;
  /** The mood chip that was active, if any. Context, never a preference. */
  mood?: string | null;
  bucket?: "safe" | "stretch" | "aspirational" | "trending" | "friends" | null;
  /** Anything else worth keeping. */
  [k: string]: unknown;
};

// ----------------------------------------------------------------------------
// Session and request ids
// ----------------------------------------------------------------------------
// A session is one foreground stretch of the app. "Seen and not taken" only
// means something inside a session: the place you scrolled past at lunch and
// tapped at dinner was not passed over, it was considered.

let sessionId = newId();
try {
  AppState.addEventListener("change", (s) => { if (s === "active") sessionId = newId(); });
} catch {
  // Not in a React Native runtime (tests). One session is fine.
}

export function currentSessionId(): string { return sessionId; }

/** Mint an id for one ranking pass. Call it where the list is built. */
export function newRequestId(): string { return newId(); }

function newId(): string {
  // Not a UUID and does not need to be: unique enough per user per day.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ----------------------------------------------------------------------------
// Attribution across screens
// ----------------------------------------------------------------------------
// A tap on a Home row opens the detail page, and the directions tap happens
// THERE. The detail page has no idea it was reached from a recommendation
// unless something remembers. This does: the last rec context per place,
// for half an hour.

const TOUCH_TTL_MS = 30 * 60 * 1000;
const touches = new Map<string, { ctx: RecEventContext; at: number }>();

export function rememberRecTouch(googlePlaceId: string, ctx: RecEventContext): void {
  touches.set(googlePlaceId, { ctx, at: Date.now() });
}

/** The rec context a place was last opened from, or null when the user got
 *  there some other way (search, a friend's visit, the wishlist). */
export function recContextFor(googlePlaceId: string): RecEventContext | null {
  const t = touches.get(googlePlaceId);
  if (!t) return null;
  if (Date.now() - t.at > TOUCH_TTL_MS) { touches.delete(googlePlaceId); return null; }
  return t.ctx;
}

// ----------------------------------------------------------------------------
// Firing
// ----------------------------------------------------------------------------

/** Fire-and-forget. Never throws into UX. */
export async function trackRecEvent(
  kind: RecEventKind,
  googlePlaceId: string,
  context: RecEventContext = {},
): Promise<void> {
  try {
    await track(`rec_${kind}`, {
      google_place_id: googlePlaceId,
      session_id: sessionId,
      ...context,
    });
  } catch {
    // Silent — analytics never block UX.
  }
}

/** One verified impression. Called by <Impression> and nothing else, so an
 *  impression always means "was on screen", never "was in the array". */
export function trackImpression(googlePlaceId: string, context: RecEventContext): void {
  void trackRecEvent("restaurant_viewed", googlePlaceId, context);
}
