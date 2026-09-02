import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, type, card, shadow } from "../theme";
import { loadRankedPlaces, type RankedPlace } from "../lib/rankings-store";
import { rankingConfidence } from "../lib/ranking";
import { triggerHapticSelection } from "../lib/haptics";
import { captureError } from "../lib/observability";

// ============================================================================
// rankings — your places, in order.
// ----------------------------------------------------------------------------
// The payoff for every "which was better?" answered after a meal. This is the
// artifact: not a rating out of five, but an ordering, which is a much harder
// thing to fake and a much more interesting thing to show someone.
//
// It states its own confidence. Two places compared once is not a ranking, and
// presenting it as one would be the app claiming to know something it doesn't —
// the same failure as a 62% match on a user with no history.
// ============================================================================

export default function RankingsScreen() {
  const router = useRouter();
  const [places, setPlaces] = useState<RankedPlace[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlaces(await loadRankedPlaces());
    } catch (e) {
      void captureError(e, { at: "rankings:load" });
      setPlaces([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const confidence = places ? rankingConfidence(places) : "none";

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Your ranking</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          />
        }
      >
        {places === null && (
          <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
        )}

        {places !== null && places.length < 2 && (
          <View style={styles.empty}>
            <Text style={styles.emptyGlyph}>◎</Text>
            <Text style={styles.emptyLine}>
              Log a couple of meals and we&apos;ll start asking which you preferred.
            </Text>
          </View>
        )}

        {places !== null && places.length >= 2 && (
          <>
            <Text style={styles.lead}>{confidenceCopy(confidence)}</Text>
            {places.map((p, i) => (
              <Pressable
                key={p.restaurantId}
                style={styles.row}
                onPress={() => {
                  void triggerHapticSelection();
                  router.push(`/restaurant/${p.googlePlaceId}` as never);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Number ${i + 1}, ${p.name}. Open place details.`}
              >
                <Text style={styles.rank}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={2}>{p.name}</Text>
                  <Text style={styles.meta}>
                    {[p.cuisine, comparisonLabel(p.comparisons)].filter(Boolean).join(" · ")}
                  </Text>
                </View>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Say how much to trust the order, rather than presenting a coin flip as a
 *  ranking. */
function confidenceCopy(c: "none" | "low" | "medium" | "high"): string {
  switch (c) {
    case "high":   return "Built from your own head-to-heads.";
    case "medium": return "Taking shape — a few more comparisons will sharpen it.";
    case "low":    return "Early days. Answer a few more and this will settle.";
    case "none":   return "";
  }
}

function comparisonLabel(n: number): string | null {
  if (n === 0) return "not compared yet";
  return `${n} comparison${n === 1 ? "" : "s"}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.faint,
  },
  closeText: { fontSize: 20, color: colors.ink },
  body: { padding: spacing.lg, paddingTop: 0 },
  lead: { ...type.small, marginBottom: spacing.md },
  center: { paddingVertical: spacing.xxl, alignItems: "center" },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: 8 },
  emptyGlyph: { fontSize: 22, color: colors.line },
  emptyLine: { ...type.small, textAlign: "center", maxWidth: 260, lineHeight: 19 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 14,
    padding: card.padding,
    borderRadius: card.radius,
    backgroundColor: colors.faint,
    marginBottom: 8,
    ...shadow.card,
  },
  rank: { ...type.title, color: colors.mute, minWidth: 28, textAlign: "center" },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
  meta: { ...type.small, marginTop: 2 },
});
