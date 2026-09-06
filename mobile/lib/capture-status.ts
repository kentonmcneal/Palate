// ============================================================================
// capture-status.ts: is the core feature actually on for this person?
// ----------------------------------------------------------------------------
// Pure. components/CaptureWarning.tsx (the strip on every tab), the Profile
// status row and the Home footer all read this one answer, so they say the
// same words and send people to the same place. Passive capture needs two
// grants the person can switch off without telling us, Location Always and
// notifications, and the whole point of the strip is that nobody opts out of
// the feature by accident.
// ============================================================================

export type CaptureWarningKind = "location" | "notifications";

/** Where the Fix button goes. */
export type CaptureFix = "passive-intro" | "ios-settings" | "notifications-intro";

export type CaptureStatus =
  | { kind: "ok"; body: string }
  | { kind: CaptureWarningKind; title: string; body: string; fix: CaptureFix };

/** Read by the Profile row when everything is on. */
export const CAPTURE_OK_BODY = "On. Location Always, notifications on.";

export function captureStatus(s: {
  always: boolean;
  whenInUse: boolean;
  notifications: boolean;
  optedIn: boolean;
}): CaptureStatus {
  if (!s.always) {
    return {
      kind: "location",
      title: "Palate can't see where you eat",
      body: s.whenInUse
        ? "Location is set to While Using. Set it to Always and your meals log themselves."
        : "Turn on location and set it to Always. Nothing is logged until you say yes.",
      // Somebody who never opted in has never seen the value screen, so the
      // funnel is the fix. Somebody who did opt in has already been through
      // it, and iOS Settings is the only place the answer can change now.
      fix: s.optedIn ? "ios-settings" : "passive-intro",
    };
  }
  if (!s.notifications) {
    return {
      kind: "notifications",
      title: "Palate can't ask you about meals",
      body: "It notices where you ate and has no way to check. Turn on notifications.",
      fix: "notifications-intro",
    };
  }
  return { kind: "ok", body: CAPTURE_OK_BODY };
}
