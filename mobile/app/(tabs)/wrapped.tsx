import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, Alert, ScrollView, Share, Pressable } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { LAST_SEEN_WRAPPED_KEY } from "./_layout";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { generateForCurrentWeek, latestWrapped, type Wrapped } from "../../lib/wrapped";
import { WrappedCard } from "../../components/WrappedCard";
import { WrappedStoryCard } from "../../components/WrappedStoryCard";
import { WrappedCharts } from "../../components/WrappedCharts";
import { WeeklyPalateInsights } from "../../components/WeeklyPalateInsights";
import { Confetti } from "../../components/Confetti";
import { shareWrappedToFeed } from "../../lib/feed";
import { track } from "../../lib/analytics";
import { computeTasteVector, type TasteVector } from "../../lib/taste-vector";
import { generateIdentitySet, generateLore, type PalateIdentitySet } from "../../lib/palate-labels";
import { getSessionStage, type SessionStage } from "../../lib/session-stage";
import ViewShot, { captureRef } from "react-native-view-shot";

// ============================================================================
// Wrapped — REFLECTION ONLY. One job: tell me what kind of eater I am.
// Layout (4 visible sections, in order):
//   1. Identity headline ("You're a Late-Night Explorer")
//   2. Three stat tiles (Visits / Variety / Repeat %)
//   3. One insight line
//   4. Share + deep-insights links
// Charts, percentiles, cohorts, "ALSO/AND/THIS WEEK" — all live on Profile →
// Insights now. Wrapped stays scannable.
// ============================================================================

export default function WrappedTab() {
  const [data, setData] = useState<Wrapped | null>(null);
  const [identities, setIdentities] = useState<PalateIdentitySet | null>(null);
  const [vector, setVector] = useState<TasteVector | null>(null);
  const [stage, setStage] = useState<SessionStage>(1);
  const [loading, setLoading] = useState(false);
  const [confettiKey, setConfettiKey] = useState(0);
  const cardRef = useRef<View>(null);
  const storyRef = useRef<View>(null);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const [latest, allTimeVec, weekVec, st] = await Promise.all([
        latestWrapped(),
        computeTasteVector().catch(() => null),
        computeTasteVector({ sinceDays: 7 }).catch(() => null),
        getSessionStage().catch(() => 1 as SessionStage),
      ]);
      setStage(st);
      setData(latest);
      if (latest?.week_start) {
        await AsyncStorage.setItem(LAST_SEEN_WRAPPED_KEY, latest.week_start);
      }
      setVector(allTimeVec ?? null);
      if (allTimeVec) setIdentities(generateIdentitySet(allTimeVec, weekVec ?? undefined));
    } catch (e: any) {
      console.warn("wrapped load", e?.message);
    }
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  async function generate() {
    setLoading(true);
    try {
      const w = await generateForCurrentWeek();
      if (!w) {
        Alert.alert("Nothing yet", "Add a visit or two this week and try again.");
      } else {
        const wasFirstReveal = !data;
        setData(w);
        setConfettiKey((k) => k + 1);
        void track("wrapped_generated", { first_reveal: wasFirstReveal });
      }
    } catch (e: any) {
      Alert.alert("Couldn't generate", e.message ?? "Try again");
    } finally {
      setLoading(false);
    }
  }

  async function shareImage() {
    if (!cardRef.current) return;
    try {
      const uri = await captureRef(cardRef, { format: "png", quality: 1 });
      await Share.share({ url: uri, message: "My Palate Wrapped" });
    } catch (e: any) {
      Alert.alert("Couldn't share", e.message ?? "Try again");
    }
  }

  async function shareToStory() {
    if (!storyRef.current) return;
    try {
      const uri = await captureRef(storyRef, { format: "png", quality: 1 });
      await Share.share({ url: uri });
    } catch (e: any) {
      Alert.alert("Couldn't share", e.message ?? "Try again");
    }
  }

  async function shareToFeed() {
    if (!data) return;
    try {
      await shareWrappedToFeed({
        personaLabel: identityLabel(),
        tagline: identities?.primary.secondary ?? "",
        weekStart: data.week_start,
        weekEnd: data.week_end,
        totalVisits: data.total_visits,
        topRestaurant: data.top_restaurant,
      });
      void track("wrapped_posted_to_feed");
      Alert.alert("Posted to feed", "Your friends will see it in their Feed tab.");
    } catch (e: any) {
      Alert.alert("Couldn't post", e.message ?? "Try again");
    }
  }

  function identityLabel(): string {
    if (stage >= 3 && identities) return identities.primary.label;
    if (data?.personality_label) return data.personality_label;
    return "Pattern Forming";
  }

  function insightLine(): string {
    if (stage < 3) return "Your pattern is forming. The identity reveals at 3 visits.";
    if (vector && identities) return generateLore(vector, identities.primary);
    return "";
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Confetti fire={confettiKey > 0} count={180} />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={type.title}>Your Wrapped</Text>
        <Spacer size={20} />

        {data ? (
          <>
            {/* 1. Identity headline */}
            <View style={styles.identityCard}>
              <Text style={styles.identityEyebrow}>YOU'RE A</Text>
              <Text style={styles.identityName}>{identityLabel()}</Text>
            </View>

            {/* 2. Three stats */}
            <View style={styles.statRow}>
              <Stat label="Visits" value={String(data.total_visits)} />
              <Stat label="Variety" value={String(data.unique_restaurants)} />
              <Stat label="Repeat" value={`${Math.round((data.repeat_rate ?? 0) * 100)}%`} />
            </View>

            {/* 3. One insight */}
            {insightLine().length > 0 && (
              <View style={styles.insightCard}>
                <Text style={styles.insightText}>{insightLine()}</Text>
              </View>
            )}

            {/* 4. Interactive charts — tap-to-focus donut + day-of-week bars */}
            <WrappedCharts />

            {/* 5. Per-week palate insights (composed from the week's vector) */}
            <WeeklyPalateInsights weekStart={data.week_start} weekEnd={data.week_end} />

            {/* 6. Actions */}
            <Spacer size={20} />
            <Pressable onPress={() => router.push("/insights-deep")} style={styles.deepLink}>
              <Text style={styles.deepLinkText}>See your full insights →</Text>
            </Pressable>

            <Spacer size={16} />
            <Button title="Share" onPress={shareImage} />
            <Spacer size={8} />
            <Button title="Post to Feed" variant="ghost" onPress={shareToFeed} />
            <Spacer size={8} />
            <Button title="Share to Instagram Story" variant="ghost" onPress={shareToStory} />
            <Spacer size={8} />
            <Button title="Refresh" variant="ghost" onPress={generate} loading={loading} />

            {/* Off-screen share renderers — used for image capture only. */}
            <View style={{ position: "absolute", left: -9999, top: 0 }} pointerEvents="none">
              <ViewShot ref={cardRef as any} options={{ format: "png", quality: 1 }}>
                <WrappedCard data={data} personaOverride={identityLabel()} />
              </ViewShot>
              <View ref={storyRef as any} collapsable={false}>
                <WrappedStoryCard data={data} personaOverride={identityLabel()} />
              </View>
            </View>
          </>
        ) : identities && vector && vector.visitCount > 0 ? (
          // Pre-Sunday: visits exist but no Wrapped row yet. Show a stripped
          // version so the tab feels alive while the user waits for Sunday.
          <>
            <View style={styles.identityCard}>
              <Text style={styles.identityEyebrow}>YOU'RE A</Text>
              <Text style={styles.identityName}>{identityLabel()}</Text>
            </View>
            <View style={styles.insightCard}>
              <Text style={styles.insightText}>{insightLine()}</Text>
            </View>
            <View style={styles.preWaitPill}>
              <Text style={styles.preWaitText}>Your first official Wrapped lands Sunday.</Text>
            </View>
            <Spacer />
            <Button title={loading ? "Generating…" : "Generate now"} onPress={generate} loading={loading} />
          </>
        ) : (
          <>
            <Text style={[type.micro, { marginBottom: 10 }]}>PREVIEW · what your Sunday will look like</Text>
            <View style={{ opacity: 0.55 }} pointerEvents="none">
              <WrappedCard data={SAMPLE_WRAPPED} />
            </View>
            <Spacer />
            <View style={styles.empty}>
              <Text style={type.subtitle}>No Wrapped yet</Text>
              <Text style={[type.body, { color: colors.mute, marginTop: 6 }]}>
                Log your first visit and we'll start reading your pattern.
              </Text>
              <Spacer />
              <Button title={loading ? "Generating…" : "Generate now"} onPress={generate} loading={loading} />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const SAMPLE_WRAPPED: Wrapped = {
  id: "sample",
  user_id: "sample",
  week_start: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
  week_end: new Date().toISOString().slice(0, 10),
  total_visits: 12,
  unique_restaurants: 7,
  top_restaurant: "Sweetgreen",
  top_category: "fast_casual",
  repeat_rate: 0.42,
  personality_label: "The Fast Casual Regular",
  wrapped_json: {
    total_visits: 12,
    unique_restaurants: 7,
    top_restaurant: "Sweetgreen",
    top_category: "fast_casual",
    repeat_rate: 0.42,
    personality_label: "The Fast Casual Regular",
    top_three: [
      { name: "Sweetgreen", count: 4 },
      { name: "Joe & The Juice", count: 2 },
      { name: "Joe's Pizza", count: 2 },
    ],
  },
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { padding: spacing.lg, paddingBottom: 100 },

  identityCard: {
    padding: spacing.lg,
    borderRadius: 22,
    backgroundColor: colors.ink,
    alignItems: "flex-start",
  },
  identityEyebrow: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  identityName: {
    color: colors.red,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.7,
    lineHeight: 38,
    marginTop: 6,
  },

  statRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    gap: 8,
  },
  statTile: {
    flex: 1,
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
  },
  statValue: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.ink,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.mute,
    letterSpacing: 1.2,
    marginTop: 4,
  },

  insightCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  insightText: { fontSize: 15, color: colors.ink, lineHeight: 21, fontStyle: "italic" },

  deepLink: {
    paddingVertical: 12,
    alignItems: "center",
  },
  deepLinkText: { color: colors.red, fontSize: 14, fontWeight: "700" },

  preWaitPill: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  preWaitText: { color: colors.ink, fontSize: 12, fontWeight: "700" },

  empty: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
});
