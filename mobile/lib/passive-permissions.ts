// ============================================================================
// passive-permissions.ts — Phase 2: the permission funnel + its instrumentation.
// ----------------------------------------------------------------------------
// Opt-in is the binding constraint, so every step is a discrete event in
// analytics_events (read as a conversion funnel). Sequence:
//   pre-screen  ->  When-In-Use  ->  (first confirmed visit)  ->  Always
// We NEVER fire the system Always prompt cold, and we degrade (not nag) on
// decline: one re-ask max, >=14 days later, only after another confirmed visit.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { track } from "./analytics";

const LAST_BG_STATUS_KEY = "palate.passive.lastBgStatus";
const LAST_ALWAYS_PROMPT_KEY = "palate.passive.lastAlwaysPromptMs";
const REASK_DAYS = 14;

export type AlwaysOutcome = "granted" | "denied" | "deferred";

export async function hasWhenInUse(): Promise<boolean> {
  const s = await Location.getForegroundPermissionsAsync().catch(() => null);
  return s?.status === "granted";
}

export async function hasAlways(): Promise<boolean> {
  const s = await Location.getBackgroundPermissionsAsync().catch(() => null);
  return s?.status === "granted";
}

/** Step 1: request When-In-Use. Never request Always here. */
export async function requestWhenInUse(): Promise<boolean> {
  void track("perm_wheninuse_requested");
  const { status } = await Location.requestForegroundPermissionsAsync();
  const granted = status === "granted";
  void track(granted ? "perm_wheninuse_granted" : "perm_wheninuse_denied");
  return granted;
}

/** Step 2 (only AFTER the user has confirmed >=1 visit): request Always. */
export async function requestAlways(): Promise<AlwaysOutcome> {
  void track("perm_always_prompt_shown");
  await AsyncStorage.setItem(LAST_ALWAYS_PROMPT_KEY, String(Date.now()));
  const { status, canAskAgain } = await Location.requestBackgroundPermissionsAsync();
  if (status === "granted") {
    void track("perm_always_granted");
    return "granted";
  }
  const outcome: AlwaysOutcome = canAskAgain ? "deferred" : "denied";
  void track(outcome === "denied" ? "perm_always_denied" : "perm_always_deferred");
  return outcome;
}

/** Whether we're allowed to re-ask for Always (degrade, don't nag). */
export async function canReAskAlways(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(LAST_ALWAYS_PROMPT_KEY);
  if (!raw) return true;
  const last = parseInt(raw, 10);
  return Number.isFinite(last) ? Date.now() - last > REASK_DAYS * 86_400_000 : true;
}

/**
 * Detect an Always -> downgraded transition on foreground (iOS downgrades
 * silently). Returns true exactly once per downgrade so the caller can show the
 * repair banner. Persists the latest status for next comparison.
 */
export async function checkPermissionDowngrade(): Promise<boolean> {
  const current = (await Location.getBackgroundPermissionsAsync().catch(() => null))?.status ?? "undetermined";
  const prev = await AsyncStorage.getItem(LAST_BG_STATUS_KEY);
  await AsyncStorage.setItem(LAST_BG_STATUS_KEY, current);
  if (prev === "granted" && current !== "granted") {
    void track("perm_always_revoked");
    return true;
  }
  return false;
}

export async function currentPermissionState(): Promise<{ whenInUse: boolean; always: boolean }> {
  return { whenInUse: await hasWhenInUse(), always: await hasAlways() };
}
