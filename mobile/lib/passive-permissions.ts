// ============================================================================
// passive-permissions.ts — Phase 2: the permission funnel + its instrumentation.
// ----------------------------------------------------------------------------
// Opt-in is the binding constraint, so every step is a discrete event in
// analytics_events (read as a conversion funnel).
//
// iOS "provisional Always" is the whole strategy here. If the app already holds
// When-In-Use and then calls requestAlwaysAuthorization(), iOS grants Always
// PROVISIONALLY and shows the user NO dialog at all. We may register CLVisit
// immediately. iOS itself prompts the user later, at a moment of its choosing,
// with real usage context ("Palate has been using your location in the
// background") and the Keep-Only-While-Using / Change-to-Always choice.
//
// That retroactive prompt converts far better than a cold modal fired at a user
// who has seen nothing yet — so this funnel never shows a cold Always modal.
// The trade-off is that background events are not delivered until that system
// prompt is answered.
//
// CRITICAL: expo-location cannot report a provisional grant correctly. Its
// background requester waits ~1.5s for a permission dialog to appear and, since
// provisional shows none, resolves as DENIED (see
// EXBackgroundLocationPermissionRequester.m — `_wasAsked` + the inactivate
// timeout). So the source of truth for "do we hold Always?" is the native
// CLLocationManager status read, never Expo's request result.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { PalateVisitMonitor, isVisitMonitorAvailable } from "../modules/palate-visit-monitor";
import { track } from "./analytics";

const LAST_BG_STATUS_KEY = "palate.passive.lastBgStatus";
const LAST_ALWAYS_PROMPT_KEY = "palate.passive.lastAlwaysPromptMs";
const REASK_DAYS = 14;

// How long to wait for CoreLocation to settle after requestAlwaysAuthorization.
// The status flips via the delegate, so it is not always current the instant
// Expo's promise resolves.
const SETTLE_TIMEOUT_MS = 3000;
const SETTLE_POLL_MS = 250;

export type AlwaysOutcome = "granted" | "denied" | "deferred";

/** Raw CoreLocation status, or null when the native module isn't in this build. */
function nativeStatus(): string | null {
  if (!isVisitMonitorAvailable || !PalateVisitMonitor) return null;
  try {
    return PalateVisitMonitor.authorizationStatus();
  } catch {
    return null;
  }
}

export async function hasWhenInUse(): Promise<boolean> {
  const native = nativeStatus();
  if (native) return native === "whenInUse" || native === "always";
  const s = await Location.getForegroundPermissionsAsync().catch(() => null);
  return s?.status === "granted";
}

/**
 * True when CoreLocation reports Always — provisional or fully confirmed. There
 * is no public API that distinguishes the two, and for our purposes there is no
 * difference: both let us register visit monitoring.
 */
export async function hasAlways(): Promise<boolean> {
  const native = nativeStatus();
  if (native) return native === "always";
  const s = await Location.getBackgroundPermissionsAsync().catch(() => null);
  return s?.status === "granted";
}

/** Poll CoreLocation until it reports Always, or the timeout expires. */
async function settleAlways(timeoutMs = SETTLE_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  // No native module (Expo Go, tests) => nothing to poll; trust the Expo read.
  if (!nativeStatus()) return hasAlways();
  while (Date.now() < deadline) {
    if (nativeStatus() === "always") return true;
    await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
  }
  return nativeStatus() === "always";
}

/** Step 1: request When-In-Use. Never requests Always. */
export async function requestWhenInUse(): Promise<boolean> {
  void track("perm_wheninuse_requested");
  const { status } = await Location.requestForegroundPermissionsAsync();
  const granted = status === "granted";
  void track(granted ? "perm_wheninuse_granted" : "perm_wheninuse_denied");
  return granted;
}

/**
 * Step 2: ask for Always. On the happy path the user sees NOTHING — iOS grants
 * provisional Always silently and defers its own prompt to the first real
 * background use. Only a previously-denied user hits a hard "no" here.
 */
export async function requestAlways(): Promise<AlwaysOutcome> {
  void track("perm_always_prompt_shown");
  await AsyncStorage.setItem(LAST_ALWAYS_PROMPT_KEY, String(Date.now()));

  let canAskAgain = true;
  try {
    const res = await Location.requestBackgroundPermissionsAsync();
    canAskAgain = res.canAskAgain;
    if (res.status === "granted") {
      void track("perm_always_granted", { provisional: false });
      return "granted";
    }
  } catch {
    // Fall through — the native read below is the authority either way.
  }

  // Expo says no. Under a provisional grant it says no while iOS said yes, so
  // believe CoreLocation over Expo before reporting failure to the user.
  if (await settleAlways()) {
    void track("perm_always_granted", { provisional: true });
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
 * Detect an Always -> downgraded transition on foreground. This is where the
 * provisional flow most often ends: iOS shows its retroactive prompt while we
 * are backgrounded, the user taps "Keep Only While Using", and the status drops
 * silently. Returns true exactly once per downgrade so the caller can show the
 * repair banner.
 */
export async function checkPermissionDowngrade(): Promise<boolean> {
  const current = (await hasAlways()) ? "granted" : "not-granted";
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


// ----------------------------------------------------------------------------
// "You opted in, but Always was never granted."
// ----------------------------------------------------------------------------
// checkPermissionDowngrade only fires on granted -> not-granted. Somebody who
// never granted Always in the first place — because onboarding used to tell
// them to pick "While Using the App" — was never told anything at all. They
// opted into passive capture, saw a tracking toggle reading ON, and got no
// visits, with nothing anywhere explaining why.
//
// Rate-limited rather than persistent: this is a real problem worth raising,
// and it is still a banner about a permission somebody may have chosen on
// purpose. Dismissing holds it for a week.

const ALWAYS_NAG_KEY = "palate.passive.alwaysNagDismissedAt";
const NAG_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export async function needsAlwaysPrompt(): Promise<boolean> {
  if (await hasAlways()) return false;
  try {
    const raw = await AsyncStorage.getItem(ALWAYS_NAG_KEY);
    if (raw && Date.now() - Number(raw) < NAG_INTERVAL_MS) return false;
  } catch {
    // Storage failure should not silence a real problem.
  }
  return true;
}

export async function dismissAlwaysPrompt(): Promise<void> {
  await AsyncStorage.setItem(ALWAYS_NAG_KEY, String(Date.now())).catch(() => {});
}
