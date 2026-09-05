// ============================================================================
// notification-primer.ts — ask once, after saying why.
// ----------------------------------------------------------------------------
// Until now the iOS notification dialog appeared the first time a session
// existed: on a new install, before the person had seen a single screen of
// the app. Nothing said what the notifications were. 6 of 14 accounts have a
// push token; the rest tapped "Don't Allow" to a question they had no context
// for, and iOS only asks once.
//
// The primer is a screen that says what you get — a friend logged a visit,
// your evening digest, Sunday's Wrapped — and then asks. It shows once per
// install, tracked here, and never to somebody who has already said yes.
//
// Same one-way gate shape as username-gate.ts, for the same reason: the guard
// in _layout reads a synchronous bit, and a bit that could re-arm itself is
// how the username loop happened.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";

const SEEN_KEY = "palate.notification_primer_seen.v1";

let seen = false;
const listeners = new Set<() => void>();

export function markPrimerSeen(): void {
  if (!seen) {
    seen = true;
    for (const l of listeners) l();
  }
  void AsyncStorage.setItem(SEEN_KEY, "1").catch(() => {});
}

export function isPrimerSeen(): boolean {
  return seen;
}

export function subscribePrimerSeen(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Whether to show the primer, from three facts. Pure, so it is testable
 * without a device:
 *   - already seen           → no
 *   - permission granted     → no (and it counts as seen)
 *   - anything else          → yes, including "blocked": that person gets the
 *                              Settings route instead of a dialog iOS will
 *                              not show
 */
export function primerDecision(s: {
  seen: boolean;
  granted: boolean;
}): "show" | "skip" {
  if (s.seen) return "skip";
  if (s.granted) return "skip";
  return "show";
}

/** Resolve once per session. */
export async function needsNotificationPrimer(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(SEEN_KEY);
    if (stored === "1") { seen = true; return false; }
  } catch {
    // Unreadable storage: show it. Once is cheap; never is not.
  }
  let granted = false;
  try {
    const Notifications = await import("expo-notifications");
    granted = (await Notifications.getPermissionsAsync()).granted;
  } catch {
    granted = false;
  }
  const decision = primerDecision({ seen, granted });
  if (granted) markPrimerSeen();
  return decision === "show";
}

/** Tests only. */
export function __resetPrimerGate(): void {
  seen = false;
}
