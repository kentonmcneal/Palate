import { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { RestaurantCompatibilityCard } from "../../components/RestaurantCompatibilityCard";
import type { FeaturedList } from "../../lib/featured-lists";
import type { RankedRestaurant } from "../../lib/restaurant-ranking";

// ============================================================================
// Featured list detail — opens when a user taps a Featured Lists card.
// We take the full payload via params (no second fetch needed) and render the
// ranked restaurants using the same card style as Discover.
// ============================================================================

export default function FeaturedListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug: string; title?: string; payload?: string }>();

  const list: FeaturedList | null = useMemo(() => {
    try {
      return params.payload ? JSON.parse(params.payload as string) : null;
    } catch {
      return null;
    }
  }, [params.payload]);

  if (!list) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={[type.body, { color: colors.mute }]}>List not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const items: RankedRestaurant[] = list.restaurants.map((r) => ({ ...r, match: null, distanceKm: null }));

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.hero}>
          <LinearGradient
            colors={list.gradient as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroContent}>
            <Text style={styles.heroEyebrow}>FEATURED LIST</Text>
            <Text style={styles.heroTitle}>{list.title}</Text>
            <Text style={styles.heroSub}>{list.subtitle}</Text>
            <View style={styles.heroProgress}>
              <Text style={styles.heroProgressText}>
                You've been to {list.visitedCount} of {list.totalCount}
              </Text>
            </View>
          </View>
        </View>

        <Spacer size={20} />

        {items.map((r, i) => (
          <View key={r.google_place_id} style={styles.itemRow}>
            <Text style={styles.rank}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <RestaurantCompatibilityCard restaurant={r} surface="discover_shelf" />
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.faint,
  },
  closeText: { fontSize: 18, fontWeight: "700", color: colors.ink },
  body: { padding: spacing.lg, paddingBottom: 80 },

  hero: {
    height: 180,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: colors.ink,
    padding: 20,
    justifyContent: "flex-end",
  },
  heroContent: { gap: 6 },
  heroEyebrow: { color: "rgba(255,255,255,0.65)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  heroTitle: { color: "#fff", fontSize: 28, fontWeight: "800", letterSpacing: -0.6, lineHeight: 32 },
  heroSub: { color: "rgba(255,255,255,0.78)", fontSize: 13, fontWeight: "600" },
  heroProgress: {
    marginTop: 8, alignSelf: "flex-start",
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  heroProgressText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 4 },
  rank: { width: 22, fontSize: 16, fontWeight: "800", color: colors.mute, paddingTop: 18 },
});
