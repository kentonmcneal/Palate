// ============================================================================
// passive-misses.ts — a ring buffer of detections that produced no prompt.
// ----------------------------------------------------------------------------
// A tester reported the opposite of the duplicate storm: at some places the
// app fires repeatedly, at others it never fires at all. The duplicates were
// diagnosable from the lock screen. The silences were not — resolveVenue()
// returned null and the detection vanished with no record of why.
//
// Each miss now records what the pipeline actually saw: how many venues came
// back, how many survived the loggable filter, the search radius, and the
// accuracy of the fix. That distinguishes the three very different failures
// hiding behind one symptom:
//
//   no_places_returned      — nothing in range. Either a genuinely remote
//                             stop or a radius/accuracy problem.
//   all_filtered_out        — venues were there and we rejected all of them.
//                             A filter bug, and the most likely culprit.
//   ranked_empty            — ranking dropped everything. Should be impossible.
//
// Kept on-device only. This is a diagnostic, not telemetry.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "palate.passive.misses";
const MAX_ENTRIES = 20;

export type MissReason = "no_places_returned" | "all_filtered_out" | "ranked_empty";

export type PassiveMiss = {
  at: number;
  reason: MissReason;
  /** Venues Google/cache returned within the radius. */
  placesFound: number;
  /** How many survived isLoggableVenue(). */
  loggableCount: number;
  radiusM: number;
  accuracyM: number | null;
  dwellMin: number | null;
  source: string | null;
  /** Names of what we rejected — the fastest way to spot a filter mistake. */
  rejectedSample: string[];
};

export async function recordMiss(miss: PassiveMiss): Promise<void> {
  try {
    const list = await listMisses();
    const next = [miss, ...list].slice(0, MAX_ENTRIES);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A diagnostic must never break the pipeline it is diagnosing.
  }
}

export async function listMisses(): Promise<PassiveMiss[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PassiveMiss[]) : [];
  } catch {
    return [];
  }
}

export async function clearMisses(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

export function describeMiss(m: PassiveMiss): string {
  switch (m.reason) {
    case "no_places_returned":
      return `Nothing within ${m.radiusM}m${m.accuracyM ? ` (fix ±${Math.round(m.accuracyM)}m)` : ""}`;
    case "all_filtered_out":
      return `${m.placesFound} nearby, all rejected as non-dining`;
    case "ranked_empty":
      return `${m.loggableCount} loggable but ranking returned none`;
  }
}
