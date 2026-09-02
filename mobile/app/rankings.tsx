import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
  Share, Alert,
} from "react-native";
import { captureRef } from "react-native-view-shot";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, type, card, shadow } from "../theme";
import { loadRankedPlaces, type RankedPlace } from "../lib/rankings-store";
import { rankingConfidence } from "../lib/ranking";
import { triggerHapticSelection } from "../lib/haptics";
import { TopFiveShareCard } from "../components/TopFiveShareCard";
import { getMyProfile } from "../lib/profile";
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
  const [myName, setMyName] = useState<string | null>(null);
  const cardRef = useRef<View>(null);

  useEffect(() => {
    void getMyProfile().then((p) => setMyName(p?.display_name ?? null)).catch(() => {});
  }, []);

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

  // Only offer the share once the order means something. Posting a list built
  // from one coin-flip would be the app inviting someone to vouch publicly for
  // a claim it hasn't earned.
  const earned = (places ?? []).filter((p) => p.comparisons > 0);
  const shareable = earned.length >= 3 && confidence !== "low" && confidence !== "none";
  const top5 = earned.slice(0, 5).map((p, i) => ({
    googlePlaceId: p.googlePlaceId,
    name: p.name,
    cuisine: p.cuisine,
    position: i + 1,
  }));

  async function shareTopFive() {
    if (!cardRef.current) return;
    try {
      void triggerHapticSelection();
      const uri = await captureRef(cardRef, { format: "png", quality: 1 });
      await Share.share({ url: uri });
    } catch (e: unknown) {
      void captureError(e, { at: "rankings:share" });
      Alert.alert("Couldn't share", "Try again in a moment.");
    }
  }

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
        {shareable && (
          <Pressable onPress={shareTopFive} style={styles.shareBtn} accessibilityRole="button">
            <Text style={styles.shareBtnText}>Share your top five</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Off-screen render target for the capture. Positioned far off the left
          edge rather than hidden — a display:none subtree has no layout, so
          ViewShot would capture nothing. */}
      {shareable && (
        <View style={styles.offscreen} pointerEvents="none">
          <View ref={cardRef} collapsable={false}>
            <TopFiveShareCard places={top5} name={myName} />
          </View>
        </View>
      )}
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
  shareBtn: {
    alignSelf: "center", marginTop: spacing.lg,
    paddingHorizontal: 20, minHeight: 44, paddingVertical: 12,
    borderRadius: 999, backgroundColor: colors.ink, justifyContent: "center",
  },
  shareBtnText: { fontSize: 15, fontWeight: "800", color: "#fff" },
  offscreen: { position: "absolute", left: -9999, top: 0 },
});
