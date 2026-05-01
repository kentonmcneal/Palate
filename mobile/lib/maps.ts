// ============================================================================
// maps.ts — opens Apple Maps or Google Maps with a search query.
// ----------------------------------------------------------------------------
// Apple Maps is iOS-native and doesn't need the app installed (opens Maps.app).
// Google Maps tries the app first via comgooglemaps://, then falls back to
// the web URL which opens in Safari.
// ============================================================================

import { Linking, Platform, Alert } from "react-native";

export function openInAppleMaps(name: string, address?: string | null) {
  const query = encodeURIComponent(address ? `${name}, ${address}` : name);
  const url = Platform.OS === "ios"
    ? `maps://?q=${query}`
    : `https://maps.apple.com/?q=${query}`;
  Linking.openURL(url).catch(() => {
    Alert.alert("Couldn't open Maps", "Try searching for it directly.");
  });
}

export async function openInGoogleMaps(name: string, address?: string | null) {
  const query = encodeURIComponent(address ? `${name}, ${address}` : name);
  // Try the Google Maps app first (custom URL scheme); fall back to the web.
  const appUrl = `comgooglemaps://?q=${query}`;
  const webUrl = `https://www.google.com/maps/search/?api=1&query=${query}`;
  try {
    const canOpenApp = await Linking.canOpenURL(appUrl);
    await Linking.openURL(canOpenApp ? appUrl : webUrl);
  } catch {
    Alert.alert("Couldn't open Google Maps", "Try searching for it directly.");
  }
}
