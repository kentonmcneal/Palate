// ============================================================================
// maps.ts — opens Apple Maps or Google Maps pointed at a specific venue.
// ----------------------------------------------------------------------------
// Anchor precedence (most reliable first):
//   1. lat/lng   — exact coordinates resolve the venue even when the name is
//                  ambiguous or shared by several places.
//   2. full street address — e.g. "1026 Spring Garden St, Philadelphia".
//   3. name only.
//
// IMPORTANT: never pass a bare neighborhood (e.g. "Callowhill") as the address.
// A neighborhood over-constrains the query — Maps searches for a business
// *named like the neighborhood* and fails to find the actual venue. Pass the
// real street address (and coordinates when available) instead.
// ============================================================================

import { Linking, Platform, Alert } from "react-native";

export type MapsTarget = {
  /** Full street address — NOT a bare neighborhood. */
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Google place id — gives Google Maps an exact, unambiguous match. */
  placeId?: string | null;
};

export function openInAppleMaps(name: string, target: MapsTarget = {}) {
  const { lat, lng, address } = target;
  // With coordinates, search at the exact spot so the right venue surfaces.
  // Otherwise fall back to name + full street address.
  const params =
    lat != null && lng != null
      ? `q=${encodeURIComponent(name)}&ll=${lat},${lng}`
      : `q=${encodeURIComponent(address ? `${name}, ${address}` : name)}`;
  const base = Platform.OS === "ios" ? "maps://" : "https://maps.apple.com/";
  Linking.openURL(`${base}?${params}`).catch(() => {
    Alert.alert("Couldn't open Maps", "Try searching for it directly.");
  });
}

export async function openInGoogleMaps(name: string, target: MapsTarget = {}) {
  const { lat, lng, address, placeId } = target;
  const query = encodeURIComponent(address ? `${name}, ${address}` : name);
  // An exact place id beats any text query; coordinates anchor the app view.
  const idParam = placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : "";
  const webUrl = `https://www.google.com/maps/search/?api=1&query=${query}${idParam}`;
  const appUrl =
    lat != null && lng != null
      ? `comgooglemaps://?q=${query}&center=${lat},${lng}`
      : `comgooglemaps://?q=${query}`;
  try {
    const canOpenApp = await Linking.canOpenURL(appUrl);
    await Linking.openURL(canOpenApp ? appUrl : webUrl);
  } catch {
    Alert.alert("Couldn't open Google Maps", "Try searching for it directly.");
  }
}
