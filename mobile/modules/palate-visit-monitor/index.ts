// ============================================================================
// palate-visit-monitor — JS bridge to the native iOS CLVisit module.
// ----------------------------------------------------------------------------
// Local Expo module (autolinked from modules/ on prebuild). It is ABSENT in
// Expo Go and in any build made before this module existed, so every consumer
// must guard on `isVisitMonitorAvailable` — the JS must never assume the native
// side is present.
// ============================================================================

import { requireNativeModule } from "expo-modules-core";

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
   *   "visit" — CLVisit (precise, but unreliable on iOS 26)
   *   "slc"   — derived from significant-location-change dwell (coarse, reliable)
   * Absent on records written by builds before the significant-change path
   * existed; treat undefined as "visit".
   */
  source?: "visit" | "slc";
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
