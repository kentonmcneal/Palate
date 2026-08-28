// ============================================================================
// palate-visit-monitor — JS bridge to the native iOS CLVisit module.
// ----------------------------------------------------------------------------
// Local Expo module (autolinked from modules/ on prebuild). It is ABSENT in
// Expo Go and in any build made before this module existed, so every consumer
// must guard on `isVisitMonitorAvailable` — the JS must never assume the native
// side is present.
// ============================================================================

import { requireNativeModule } from "expo-modules-core";

/** One line of the detector's rolling trace: "<epochSeconds>|<kind>|<detail>". */
export type StopLogEntry = { at: number; kind: string; detail: string };

export type NativeStopCandidate = {
  lat: number;
  lng: number;
  accuracy: number;
  firstSeenAt: number;
  lastSeenAt: number;
  dwellSec: number;
  /** How long since the last location fix — large values mean iOS went quiet. */
  sinceLastFixSec: number;
  emitted: boolean;
  /** Negative once the dwell threshold has passed. */
  secUntilDwellCheck: number;
};

export type NativeStopState = {
  monitoring: boolean;
  minDwellSec: number;
  stopRadiusM: number;
  awaitingPreciseFix: boolean;
  candidate?: NativeStopCandidate;
  log: string[];
};

export type NativeRawVisit = {
  id: string;
  lat: number;
  lng: number;
  horizontalAccuracy: number;
  /** epoch ms; null when CLVisit did not bound the arrival */
  arrivalAt: number | null;
  /** epoch ms; null when the visit is still open (no departure yet) */
  departureAt: number | null;
  capturedAt: number;
  simulated: boolean;
  /**
   * How this detection was produced.
   *   "stop"  — on-device stop detection + a one-shot precise fix (primary)
   *   "visit" — CLVisit (precise, but unreliable on iOS 26)
   *   "slc"   — legacy significant-change dwell (coarse); no longer emitted,
   *             but may still be queued on a device that ran 0.1.2
   * Absent on records written by builds before the significant-change path
   * existed; treat undefined as "visit".
   */
  source?: "stop" | "visit" | "slc";
};

export type AuthStatus =
  | "always"
  | "whenInUse"
  | "denied"
  | "restricted"
  | "notDetermined"
  | "unknown";

type NativeModule = {
  startMonitoring(): boolean;
  stopMonitoring(): boolean;
  getPendingVisits(): NativeRawVisit[];
  clearVisits(ids: string[]): number;
  authorizationStatus(): AuthStatus;
  stopState(): NativeStopState;
  clearStopLog(): boolean;
  addListener(event: "onVisit", listener: (visit: NativeRawVisit) => void): { remove: () => void };
  simulateVisit(lat: number, lng: number, dwellMinutes: number): NativeRawVisit;
};

let nativeModule: NativeModule | null = null;
try {
  nativeModule = requireNativeModule<NativeModule>("PalateVisitMonitor");
} catch {
  nativeModule = null;
}

export const PalateVisitMonitor = nativeModule;
export const isVisitMonitorAvailable = nativeModule !== null;

/**
 * Subscribe to visits the native layer persists while the app is ALIVE —
 * foreground or background. This is the difference between passive and
 * not: iOS wakes us for a location event without ever making the app
 * "active", so an AppState-driven pipeline would leave the visit sitting on
 * disk until the user happened to open Palate. Returns null when the native
 * module is absent (Expo Go, older binaries), so callers must null-check.
 */
export function addVisitListener(
  listener: (visit: NativeRawVisit) => void,
): { remove: () => void } | null {
  if (!nativeModule) return null;
  try {
    return nativeModule.addListener("onVisit", listener);
  } catch {
    return null;
  }
}

/**
 * Live detector state for the debug screen. Detection happens in the background
 * over minutes with nobody watching, so without this a failed field test only
 * ever reports "nothing happened" — identical whether no fix arrived, the
 * candidate kept resetting, or the emit fired and the JS pipeline dropped it.
 */
export function getStopState(): NativeStopState | null {
  if (!nativeModule) return null;
  try {
    return nativeModule.stopState();
  } catch {
    return null;
  }
}

export function clearStopLog(): void {
  try {
    nativeModule?.clearStopLog();
  } catch {
    // debug-only affordance; never surface a failure
  }
}

/** Parse the native "<epochSeconds>|<kind>|<detail>" trace lines. */
export function parseStopLog(lines: string[]): StopLogEntry[] {
  return lines
    .map((line) => {
      const [at, kind, ...rest] = line.split("|");
      const seconds = Number(at);
      if (!Number.isFinite(seconds) || !kind) return null;
      return { at: seconds * 1000, kind, detail: rest.join("|") };
    })
    .filter((e): e is StopLogEntry => e !== null);
}
