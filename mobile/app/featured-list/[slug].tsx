import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { RestaurantCompatibilityCard } from "../../components/RestaurantCompatibilityCard";
import {
  getCachedFeaturedList, buildFeaturedLists, type FeaturedList,
} from "../../lib/featured-lists";
import { getEffectiveLocation, useBrowsingCity } from "../../lib/browsing-location";
import { computeTasteVector } from "../../lib/taste-vector";
import { loadPersonalSignal } from "../../lib/personal-signal";
import {
  assembleGraph, buildRankedRestaurant, type RankedRestaurant,
} from "../../lib/recommendation";

// ============================================================================
// Featured list detail — pulls from the in-memory cache populated by the
// Discover row. Cold-deep-link path: rebuild lists, then look up by slug.
// ============================================================================

export default function FeaturedListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug: string }>();
  const slug = params.slug as string;
  const [browsingCity] = useBrowsingCity();

  const [list, setList] = useState<FeaturedList | null>(() => getCachedFeaturedList(slug));
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  const [items, setItems] = useState<RankedRestaurant[]>([]);

  useEffect(() => {
    if (list) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const here = await getEffectiveLocation().catch(() => null);
        if (!here) { if (alive) { setMissing(true); setLoading(false); } return; }
        await buildFeaturedLists({ here, city: browsingCity?.name ?? null });
        const found = getCachedFeaturedList(slug);
        if (alive) {
          if (found) setList(found);
          else setMissing(true);
          setLoading(false);
        }
      } catch {
        if (alive) { setMissing(true); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, [slug, browsingCity?.id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><Text style={[type.body, { color: colors.mute }]}>Loading list…</Text></View>
      </SafeAreaView>
    );
  }

  // Whenever the list resolves, build canonical RankedRestaurant items so the
  // shared card component reads a consistent compatibility shape.
  useEffect(() => {
    if (!list) return;
    let alive = true;
    (async () => {
      const [vector, personal, here] = await Promise.all([
        computeTasteVector().catch(() => null),
        loadPersonalSignal().catch(() => null),
        getEffectiveLocation().catch(() => null),
      ]);
      if (!alive) return;
      const graph = assembleGraph(vector, personal);
      setItems(list.restaurants.map((r) =>
        buildRankedRestaurant(graph, r, { here: here ?? undefined, now: new Date() })
      ));
    })();
    return () => { alive = false; };
  }, [list]);

  if (missing || !list) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.closeBtn}>
            <Text style={styles.closeText}>←</Text>
          </Pressable>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.center}>
          <Text style={[type.body, { color: colors.mute }]}>This list isn't available here yet.</Text>
        </View>
      </SafeAreaView>
    );
  }

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
