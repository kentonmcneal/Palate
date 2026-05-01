import * as Location from "expo-location";
import { supabase } from "./supabase";

export type LatLng = { lat: number; lng: number; accuracy?: number };

/**
 * Asks for "When in use" location permission.
 * Returns the granted status and a human-readable explanation we show on screen.
 */
export async function requestForegroundPermission(): Promise<{
  granted: boolean;
  status: Location.PermissionStatus;
}> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return { granted: status === "granted", status };
}

export async function getCurrentLocation(): Promise<LatLng> {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Location permission not granted");
  }
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? undefined,
  };
}

// Confidence threshold (meters). Above this and we don't trust the fix enough
// to silently auto-detect — we ask the user "inside or nearby?" instead.
export const HIGH_CONFIDENCE_ACCURACY_M = 50;
export const LOW_CONFIDENCE_ACCURACY_M = 200;

export type DetectionConfidence = "high" | "medium" | "low";

export function classifyAccuracy(accuracyM: number | undefined | null): DetectionConfidence {
  if (accuracyM == null) return "low";
  if (accuracyM <= HIGH_CONFIDENCE_ACCURACY_M) return "high";
  if (accuracyM <= LOW_CONFIDENCE_ACCURACY_M) return "medium";
  return "low";
}

/** Records a location event for the current user (used to rate-limit + audit). */
export async function logLocationEvent(loc: LatLng, nearestPlaceId?: string | null) {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;
  await supabase.from("location_events").insert({
    user_id: user.id,
    latitude: loc.lat,
    longitude: loc.lng,
    accuracy_m: loc.accuracy ?? null,
    nearest_place_id: nearestPlaceId ?? null,
    prompt_shown: false,
  });
}
