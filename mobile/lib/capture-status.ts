// Shared opt-in/permission status, not proof that the monitor or remote flags
// are on. CoreLocation's Always result cannot distinguish provisional grants.
export type CaptureWarningKind = "opt-in" | "location" | "notifications";
export type CaptureFix = "passive-intro" | "ios-settings" | "notifications-intro";
export type CaptureStatus =
  | { kind: "ok"; body: string }
  | { kind: "unknown"; title: string; body: string }
  | { kind: CaptureWarningKind; title: string; body: string; fix: CaptureFix };

export const CAPTURE_OK_BODY = "Location and notifications are allowed. Review suggested food or drink stops before adding them.";
const unknown = (): CaptureStatus => ({ kind: "unknown", title: "Capture settings could not be checked", body: "Return to this screen or reopen Palate to check again. You can still add food or drink visits yourself." });

export function captureStatus(s: {
  always: boolean | null;
  whenInUse: boolean | null;
  notifications: boolean | null;
  optedIn: boolean | null;
  quietNotifications?: boolean;
}): CaptureStatus {
  if (s.optedIn === null) return unknown();
  if (!s.optedIn) return {
    kind: "opt-in", title: "Passive capture is off",
    body: "You have not opted in. Choose whether Palate may look for possible food or drink stops. Visits still need your confirmation.",
    fix: "passive-intro",
  };
  if (s.always === null) return unknown();
  if (!s.always) return {
    kind: "location", title: "Background location needs permission",
    body: s.whenInUse === true
      ? "Location is set to While Using. Always permission lets Palate look for possible food or drink stops in the background. It may miss stops; you confirm visits before they are logged."
      : "Allow background location to help Palate find possible food or drink stops. It may miss stops; you confirm visits before they are logged.",
    fix: "ios-settings",
  };
  if (s.notifications === null) return unknown();
  if (!s.notifications) return {
    kind: "notifications", title: "Visit notifications are not allowed",
    body: "Allow notifications for reminders to review possible food or drink stops. You can also review detected visits in the app.",
    fix: "notifications-intro",
  };
  return { kind: "ok", body: s.quietNotifications
    ? "Location is allowed. Notifications may arrive quietly. Review suggested food or drink stops before adding them."
    : CAPTURE_OK_BODY };
}
