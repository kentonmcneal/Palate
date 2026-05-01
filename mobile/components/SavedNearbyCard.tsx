import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Linking, Platform, Alert } from "react-native";
import { colors, spacing, type } from "../theme";
import { listWishlist, type WishlistEntry } from "../lib/palate-insights";
import { getCurrentLocation } from "../lib/location";
import { distanceKm, formatDistance } from "../lib/match-score";

// ============================================================================
// SavedNearbyCard — resurfaces a saved spot that's actually close right now.
// Only renders when there's a meaningful match. Otherwise stays out of the way.
// ============================================================================

const NEARBY_KM = 2; // ~1.2 miles — feels like "right now nearby"

type Pick = { entry: WishlistEntry; km: number };

export function SavedNearbyCard() {
  const [pick, setPick] = useState<Pick | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [entries, here] = await Promise.all([
          listWishlist(),
          getCurrentLocation().catch(() => null),
        ]);
        if (!alive || !here) return;

        const candidates = entries
          .map((e) => {
            const r = e.restaurant;
            if (!r?.latitude || !r?.longitude) return null;
            const km = distanceKm({ lat: here.lat, lng: here.lng }, { lat: r.latitude, lng: r.longitude });
            return { entry: e, km };
          })
          .filter((x): x is Pick => x !== null && x.km <= NEARBY_KM)
          .sort((a, b) => a.km - b.km);

        if (alive && candidates[0]) setPick(candidates[0]);
      } catch {
        // silent — card just won't render
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!pick) return null;
  const r = pick.entry.restaurant!;
  const dist = formatDistance(pick.km);

  function openInMaps() {
    const query = encodeURIComponent(r.neighborhood ? `${r.name}, ${r.neighborhood}` : r.name);
    const url = Platform.OS === "ios"
      ? `maps://?q=${query}`
      : `https://www.google.com/maps/search/?api=1&query=${query}`;
    Linking.openURL(url).catch(() => {
      Alert.alert("Couldn't open Maps", "Try searching for it directly in Maps.");
    });
  }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>YOU SAVED THIS</Text>
      <Text style={styles.name}>{r.name}</Text>
      <Text style={styles.sub}>
        {dist}{r.neighborhood ? ` · ${r.neighborhood}` : ""}
      </Text>
      <Text style={styles.nudge}>Nearby right now — worth a stop?</Text>
      <View style={styles.actions}>
        <Pressable onPress={openInMaps} style={styles.btnPrimary}>
          <Text style={styles.btnPrimaryText}>Take me there</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.xl,
    padding: spacing.md,
    borderRadius: 22,
    backgroundColor: colors.ink,
  },
  eyebrow: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  name: { color: "#fff", fontSize: 22, fontWeight: "800", letterSpacing: -0.4, marginTop: 6 },
  sub: { color: "rgba(255,255,255,0.78)", fontSize: 14, marginTop: 4 },
  nudge: { color: colors.red, fontSize: 14, fontWeight: "700", marginTop: 12 },
  actions: { marginTop: 12, flexDirection: "row" },
  btnPrimary: {
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999,
    backgroundColor: colors.red,
  },
  btnPrimaryText: { color: "#fff", fontSize: 14, fontWeight: "800" },
});
