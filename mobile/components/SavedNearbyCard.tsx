import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Linking, Platform, Alert } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { listWishlist, type WishlistEntry } from "../lib/palate-insights";
import { getEffectiveLocation, useBrowsingCity } from "../lib/browsing-location";
import { distanceKm, formatDistance } from "../lib/match-score";

// ============================================================================
// SavedNearbyCard — "Places you've been meaning to go".
// Shows 2-3 saved spots, nearest first when location is available.
// Renders nothing when wishlist is empty (Home stays clean for new users).
// ============================================================================

const MAX = 3;

type Pick = { entry: WishlistEntry; km: number | null };

export function SavedNearbyCard() {
  const router = useRouter();
  const [picks, setPicks] = useState<Pick[]>([]);
  const [browsingCity] = useBrowsingCity();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [entries, here] = await Promise.all([
          listWishlist(),
          getEffectiveLocation().catch(() => null),
        ]);
        if (!alive) return;

        const ranked: Pick[] = entries.map((e) => {
          const r = e.restaurant;
          const km = (here && r?.latitude != null && r?.longitude != null)
            ? distanceKm({ lat: here.lat, lng: here.lng }, { lat: r.latitude, lng: r.longitude })
            : null;
          return { entry: e, km };
        });

        // Nearest first; entries without a distance fall to the back but are still shown.
        ranked.sort((a, b) => {
          if (a.km == null && b.km == null) return 0;
          if (a.km == null) return 1;
          if (b.km == null) return -1;
          return a.km - b.km;
        });

        if (alive) setPicks(ranked.slice(0, MAX));
      } catch {
        // silent — card just won't render
      }
    })();
    return () => { alive = false; };
  }, [browsingCity?.id]);

  if (picks.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>SAVED RESTAURANTS</Text>
        <Pressable onPress={() => router.push("/(tabs)/wishlist")}>
          <Text style={styles.viewAll}>View all →</Text>
        </Pressable>
      </View>
      {picks.map((p) => <SavedRow key={p.entry.id} pick={p} />)}
    </View>
  );
}

function SavedRow({ pick }: { pick: Pick }) {
  const r = pick.entry.restaurant!;
  const sub = [
    pick.km != null ? formatDistance(pick.km) : null,
    r.neighborhood,
  ].filter(Boolean).join(" · ");

  function openInMaps() {
    const query = encodeURIComponent(r.neighborhood ? `${r.name}, ${r.neighborhood}` : r.name);
    const url = Platform.OS === "ios"
      ? `maps://?q=${query}`
      : `https://www.google.com/maps/search/?api=1&query=${query}`;
    Linking.openURL(url).catch(() => {
      Alert.alert("Couldn't open Maps", "Try searching for it in Maps.");
    });
  }

  return (
    <Pressable style={styles.row} onPress={openInMaps}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
        {sub.length > 0 && <Text style={styles.sub}>{sub}</Text>}
      </View>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: 22,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  head: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: 4,
  },
  eyebrow: { ...type.micro },
  viewAll: { fontSize: 12, fontWeight: "700", color: colors.red },
  row: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12,
    borderTopColor: colors.line, borderTopWidth: 1,
  },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
  sub: { ...type.small, marginTop: 2 },
  chev: { fontSize: 22, color: colors.mute, marginLeft: 8 },
});
