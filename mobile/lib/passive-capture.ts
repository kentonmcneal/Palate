// ============================================================================
// passive-capture.ts — Phase 1 orchestration for passive dining capture.
// ----------------------------------------------------------------------------
// Bridges the native CLVisit module to a durable JS-side queue. Phase 1 STOPS at
// "raw visits landing in local storage" — qualification (dwell/home-work) and
// venue resolution are Phase 3, confirmation is Phase 4.
//
// Two gates before any background monitoring starts:
//   1. Remote kill switch (feature_flags: passive_capture_detection)
//   2. Always location permission actually granted
// Either missing => we do nothing. The feature ships dark.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import {
  PalateVisitMonitor,
  isVisitMonitorAvailable,
  type NativeRawVisit,
  type AuthStatus,
} from "../modules/palate-visit-monitor";
import { isFlagEnabled } from "./flags";

export const PASSIVE_CAPTURE_FLAG = "passive_capture_detection";
const QUEUE_KEY = "palate.passiveCapture.queue";

export type RawVisit = NativeRawVisit;

export type StartResult =
  | { started: true }
  | { started: false; reason: "native-module-unavailable" | "flag-off" | "no-always-permission" };

/** Start passive capture only if the remote flag is ON and Always is granted. */
export async function startPassiveCaptureIfEnabled(): Promise<StartResult> {
  if (!isVisitMonitorAvailable || !PalateVisitMonitor) {
    return { started: false, reason: "native-module-unavailable" };
  }
  if (!(await isFlagEnabled(PASSIVE_CAPTURE_FLAG))) {
    return { started: false, reason: "flag-off" };
  }
  const perm = await Location.getBackgroundPermissionsAsync().catch(() => null);
  if (perm?.status !== "granted") {
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
