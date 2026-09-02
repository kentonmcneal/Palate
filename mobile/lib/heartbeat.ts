// ============================================================================
// heartbeat.ts — who is here, and what are they running.
// ----------------------------------------------------------------------------
// On 2026-09-02 two questions could not be answered about a 13-person user
// base: when someone last opened the app, and which build they were on.
//
// The second one blocked a real diagnosis. Passive capture had produced a visit
// for exactly one person. One user granted location on 2026-08-07, stayed
// active for a month, and never had a single detection — and the most likely
// explanation was that his binary predated the commit where the native visit
// monitor actually started shipping. "Most likely" is where it stopped, because
// nothing recorded his version.
//
// One write on foreground, throttled to once an hour. Cheap, and it turns both
// questions into a column read.
// ============================================================================

import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabase";

let lastBeatAt = 0;
/** A heartbeat is not worth a round trip on every app switch. */
const MIN_INTERVAL_MS = 60 * 60 * 1000;

export async function recordHeartbeat(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastBeatAt < MIN_INTERVAL_MS) return;
  lastBeatAt = now;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from("profiles")
      .update({
        last_seen_at: new Date().toISOString(),
        app_version: Constants.expoConfig?.version ?? null,
        app_build:
          Platform.OS === "ios"
            ? (Constants.expoConfig?.ios?.buildNumber ?? null)
            : String(Constants.expoConfig?.android?.versionCode ?? "") || null,
      })
      .eq("id", user.id);
  } catch {
    // Telemetry must never affect the session it is measuring.
  }
}
