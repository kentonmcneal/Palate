// ============================================================================
// auto-detect.ts — minimum-viable auto-detection of restaurant visits.
// ----------------------------------------------------------------------------
// Activated by the "Auto-detect visits" toggle in Settings. When ON, every
// time the app is foregrounded we:
//   1. Fetch current location (foreground only — no background tracking)
//   2. Look up nearby restaurants via the existing places API
//   3. If user appears to be AT a restaurant (proximity + accuracy), open the
//      confirm-visit modal: "Are you eating at [Name]?"
//
// Throttling:
//   • At most one prompt per FOREGROUND_THROTTLE_MS window
//   • A place that was recently dismissed/declined is suppressed for the day
//
// We deliberately avoid background location, geofences, and silent push —
// that's a permission and battery cost the early app doesn't need.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { router } from "expo-router";
import { getCurrentLocation, classifyAccuracy, requestForegroundPermission } from "./location";
import { nearbyRestaurants } from "./places";
import { recentlyPrompted } from "./visits";

export const TRACKING_PAUSED_KEY = "palate.tracking.paused";
const LAST_AUTO_DETECT_KEY = "palate.tracking.lastForegroundCheckMs";

// Don't re-check on every micro-foreground (e.g. tap home, tap back). One
// every 90 seconds is plenty — visits don't happen that fast.
const FOREGROUND_THROTTLE_MS = 90 * 1000;

// Distance from the restaurant centroid we treat as "at the place." Google
// Places gives us a centroid, not a polygon — 75m is the reliable bound.
const AT_PLACE_RADIUS_M = 75;

export async function isAutoDetectEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(TRACKING_PAUSED_KEY);
  return v !== "1";
}

export async function setAutoDetectEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(TRACKING_PAUSED_KEY, on ? "0" : "1");
}

/**
 * Fired whenever the app comes to foreground. Returns silently when the
 * toggle is off, the throttle window is open, permission is missing, or
 * we're not within proximity of a known restaurant.
 *
 * Callers should not await this — it's intentionally fire-and-forget.
 */
export async function checkForAutoVisitOnForeground(): Promise<void> {
  try {
    if (!(await isAutoDetectEnabled())) return;

    const lastRaw = await AsyncStorage.getItem(LAST_AUTO_DETECT_KEY);
    const last = lastRaw ? parseInt(lastRaw, 10) : 0;
    if (Number.isFinite(last) && Date.now() - last < FOREGROUND_THROTTLE_MS) return;
    await AsyncStorage.setItem(LAST_AUTO_DETECT_KEY, String(Date.now()));

    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return;

    const loc = await getCurrentLocation().catch(() => null);
    if (!loc) return;
    if (classifyAccuracy(loc.accuracy) === "low") return;

    const places = await nearbyRestaurants(loc.lat, loc.lng, 250).catch(() => []);
    if (!places.length) return;

    // Pick the closest place we can compute a distance for.
    const target = places
      .map((p) => ({
        place: p,
        distM: distanceMeters(loc.lat, loc.lng, p.latitude ?? null, p.longitude ?? null),
      }))
      .filter((c) => c.distM != null && c.distM <= AT_PLACE_RADIUS_M)
      .sort((a, b) => (a.distM ?? 0) - (b.distM ?? 0))[0];

    if (!target) return;

    // Skip places we already prompted recently (handled in visits.ts).
    if (await recentlyPrompted(target.place.google_place_id)) return;

    router.push({
      pathname: "/confirm-visit",
      params: {
        place_id: target.place.google_place_id,
        name: target.place.name,
        address: target.place.address ?? "",
        alternates: JSON.stringify(
          places
            .slice(0, 6)
            .filter((p) => p.google_place_id !== target.place.google_place_id),
        ),
        confidence: "high",
      },
    });
  } catch {
    // Auto-detect is best-effort. Never throw into the foreground listener.
  }
}

/**
 * Called from Settings when the user flips the toggle ON. Requests location
 * permission if not already granted. Returns false if the user denied so the
 * caller can show the "Auto-detect needs location access" banner.
 */
export async function ensureAutoDetectPermission(): Promise<{ granted: boolean }> {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status === "granted") return { granted: true };
  const { granted } = await requestForegroundPermission();
  return { granted };
}

function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number | null,
  lng2: number | null,
): number | null {
  if (lat2 == null || lng2 == null) return null;
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
