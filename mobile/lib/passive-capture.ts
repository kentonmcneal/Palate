// ============================================================================
// passive-capture.ts — Phase 1 orchestration for passive dining capture.
// ----------------------------------------------------------------------------
// Bridges the native CLVisit module to a durable JS-side queue. Phase 1 STOPS at
// "raw visits landing in local storage" — qualification (dwell/home-work) and
// venue resolution are Phase 3, confirmation is Phase 4.
//
// Three independent gates before any background monitoring starts:
//   1. User opt-in (Settings toggle / onboarding funnel)
//   2. Remote kill switch (feature_flags: passive_capture_detection)
//   3. CoreLocation reporting Always — provisional or confirmed
// Any one missing => we do nothing. The feature ships dark.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  PalateVisitMonitor,
  isVisitMonitorAvailable,
  type NativeRawVisit,
  type AuthStatus,
} from "../modules/palate-visit-monitor";
import { isFlagEnabled } from "./flags";

export const PASSIVE_CAPTURE_FLAG = "passive_capture_detection";
const QUEUE_KEY = "palate.passiveCapture.queue";
const OPT_IN_KEY = "palate.passive.optIn";
const OPT_IN_AT_KEY = "palate.passive.optInAt";
const DAY7_REPORTED_KEY = "palate.passive.day7Reported";

export type RawVisit = NativeRawVisit;

export type StartResult =
  | { started: true }
  | {
      started: false;
      reason: "native-module-unavailable" | "flag-off" | "no-always-permission" | "not-opted-in";
    };

/**
 * Start passive capture only if the remote flag is ON and CoreLocation reports
 * Always. The status is read natively on purpose: a PROVISIONAL Always grant
 * (the normal outcome of our funnel) reads as `authorizedAlways` here, while
 * expo-location's request path reports it as denied. Registering visit
 * monitoring under a provisional grant is exactly what we want — iOS holds the
 * events until it has asked the user, then delivers.
 */
export async function startPassiveCaptureIfEnabled(): Promise<StartResult> {
  if (!isVisitMonitorAvailable || !PalateVisitMonitor) {
    return { started: false, reason: "native-module-unavailable" };
  }
  if (!(await isFlagEnabled(PASSIVE_CAPTURE_FLAG))) {
    // Off means off on the device too, not only in the JS pipeline. Without
    // this the native manager kept running on every phone that had started.
    PalateVisitMonitor.stopMonitoring();
    return { started: false, reason: "flag-off" };
  }
  if (PalateVisitMonitor.authorizationStatus() !== "always") {
    return { started: false, reason: "no-always-permission" };
  }
  PalateVisitMonitor.startMonitoring();
  return { started: true };
}

export function stopPassiveCapture(): void {
  if (isVisitMonitorAvailable && PalateVisitMonitor) {
    PalateVisitMonitor.stopMonitoring();
  }
}

// ---------------------------------------------------------------------------
// User opt-in. Distinct from both the remote kill switch and the OS permission:
// a granted Always permission must never by itself mean "keep monitoring", or
// turning the feature off in Settings would silently undo itself on the next
// launch. Three independent gates, all required: user opt-in, remote flag, OS
// permission.
// ---------------------------------------------------------------------------

export async function isPassiveOptedIn(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(OPT_IN_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function setPassiveOptIn(value: boolean): Promise<void> {
  await AsyncStorage.setItem(OPT_IN_KEY, value ? "1" : "0");
  // Stamp the first opt-in so the day-7 permission check has an origin. Not
  // overwritten on a re-opt-in: the question is how long the grant has survived.
  if (value && !(await AsyncStorage.getItem(OPT_IN_AT_KEY))) {
    await AsyncStorage.setItem(OPT_IN_AT_KEY, String(Date.now()));
  }
}

// ---------------------------------------------------------------------------
// Day-7 permission state
// ---------------------------------------------------------------------------
//
// "% granting Always at onboarding" measures nothing under this funnel. iOS
// grants Always PROVISIONALLY with no dialog, then prompts the user itself days
// later at a moment it chooses. Measured at onboarding the number is ~100% and
// the real attrition — people answering "Keep Only While Using" to a prompt we
// never see — appears nowhere.
//
// Day 7 is after iOS has almost always asked, so it reflects what people
// actually kept rather than what they were silently given.

export const DAY7_MS = 7 * 24 * 60 * 60 * 1000;

/** Pure for testability: has the day-7 mark passed, and is this the first time? */
export function shouldReportDay7(
  optInAt: number | null,
  now: number,
  alreadyReported: boolean,
): boolean {
  if (alreadyReported || optInAt == null) return false;
  return now - optInAt >= DAY7_MS;
}

/**
 * Emit the day-7 Always state exactly once per install. Safe to call on every
 * foreground; it no-ops until the mark passes and never fires twice.
 */
export async function reportDay7PermissionState(
  hasAlwaysNow: () => Promise<boolean>,
  emit: (granted: boolean, daysSinceOptIn: number) => void,
): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(OPT_IN_AT_KEY);
    const optInAt = raw ? parseInt(raw, 10) : null;
    const reported = (await AsyncStorage.getItem(DAY7_REPORTED_KEY)) === "1";
    const now = Date.now();
    if (!shouldReportDay7(Number.isFinite(optInAt as number) ? optInAt : null, now, reported)) {
      return false;
    }
    const granted = await hasAlwaysNow();
    emit(granted, Math.floor((now - (optInAt as number)) / 86_400_000));
    // Marked AFTER emitting, so a crash mid-report retries rather than losing
    // the only measurement this install will ever produce.
    await AsyncStorage.setItem(DAY7_REPORTED_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** Turn passive capture off for real: forget the opt-in and disarm the native monitor. */
export async function optOutOfPassiveCapture(): Promise<void> {
  await setPassiveOptIn(false);
  stopPassiveCapture();
}

/**
 * Re-arm monitoring on app start/foreground for a user who already opted in.
 * The native layer re-arms itself after a cold background relaunch, so this is
 * the repair path for the cases it can't cover: a reinstall, a permission the
 * user re-granted in iOS Settings, or a flag that was off at opt-in time.
 * Never prompts — a user who hasn't opted in is left alone.
 */
export async function resumePassiveCaptureIfOptedIn(): Promise<StartResult> {
  if (!(await isPassiveOptedIn())) return { started: false, reason: "not-opted-in" };
  return startPassiveCaptureIfEnabled();
}

/**
 * Drain visits the native layer persisted while we were backgrounded or dead,
 * append them (deduped by id) to a durable JS-side queue, and clear them
 * natively. Call on foreground. Network is never on the path — detection and
 * local persistence must never block on connectivity.
 */
export async function drainNativeVisits(): Promise<RawVisit[]> {
  if (!isVisitMonitorAvailable || !PalateVisitMonitor) return getQueuedVisits();
  const pending = PalateVisitMonitor.getPendingVisits();
  const existing = await getQueuedVisits();
  if (!pending.length) return existing;

  const seen = new Set(existing.map((v) => v.id));
  const fresh = pending.filter((v) => !seen.has(v.id));
  const merged = [...existing, ...fresh];
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(merged));
  PalateVisitMonitor.clearVisits(pending.map((v) => v.id));
  return merged;
}

export async function getQueuedVisits(): Promise<RawVisit[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as RawVisit[]) : [];
  } catch {
    return [];
  }
}

export async function clearQueuedVisits(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

export function authorizationStatus(): AuthStatus | "native-module-unavailable" {
  if (!isVisitMonitorAvailable || !PalateVisitMonitor) return "native-module-unavailable";
  return PalateVisitMonitor.authorizationStatus();
}

/** Debug-only: inject a fake visit to verify the pipeline end to end. */
export function simulateVisit(lat: number, lng: number, dwellMinutes: number): RawVisit | null {
  if (!isVisitMonitorAvailable || !PalateVisitMonitor) return null;
  return PalateVisitMonitor.simulateVisit(lat, lng, dwellMinutes);
}
