import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { listWishlist, type WishlistEntry } from "../lib/palate-insights";
import { openInAppleMaps } from "../lib/maps";

// ============================================================================
// NextMovesPreview — Home tab card showing your saved spots so they don't
// disappear into the Try List tab. Horizontal scroll, max 5 visible.
// ============================================================================

export function NextMovesPreview() {
  const router = useRouter();
  const [entries, setEntries] = useState<WishlistEntry[]>([]);

  useEffect(() => {
    let alive = true;
    listWishlist().then((rows) => {
      if (alive) setEntries(rows.slice(0, 5));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (entries.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={type.micro}>YOUR NEXT MOVES</Text>
        <Pressable onPress={() => router.push("/(tabs)/wishlist")}>
          <Text style={styles.viewAll}>View all →</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingTop: 10 }}>
        {entries.map((e) => {
          const r = e.restaurant;
          if (!r) return null;
          return (
            <View key={e.id} style={styles.card}>
              <Text style={styles.name} numberOfLines={2}>{r.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {[r.cuisine_type ? cap(r.cuisine_type) : null, r.neighborhood].filter(Boolean).join(" · ")}
              </Text>
              <Pressable
                onPress={() => openInAppleMaps(r.name, r.neighborhood ?? null)}
                style={styles.mapsBtn}
              >
                <Text style={styles.mapsBtnText}>Maps</Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.xl },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  viewAll: { color: colors.red, fontSize: 13, fontWeight: "700" },
  card: {
    width: 180,
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink },
  sub: { fontSize: 12, color: colors.mute, marginTop: 4 },
  mapsBtn: {
    marginTop: 10, alignSelf: "flex-start",
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  mapsBtnText: { fontSize: 11, fontWeight: "700", color: colors.ink },
});
