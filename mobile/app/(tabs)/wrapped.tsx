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
import { WeeklyPalateInsights } from "../../components/WeeklyPalateInsights";
import { WrappedCharts } from "../../components/WrappedCharts";
import { Confetti } from "../../components/Confetti";
import { shareWrappedToFeed } from "../../lib/feed";
import { track } from "../../lib/analytics";
import { computeTasteVector, type TasteVector } from "../../lib/taste-vector";
import { generateIdentitySet, generateLore, expandedLore, type PalateIdentitySet } from "../../lib/palate-labels";
import { generatePercentileCards, generateCohortInsightAsync, type CohortInsight } from "../../lib/population-stats";
import { useEffect as useEffectReact } from "react";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import { getSessionStage, type SessionStage } from "../../lib/session-stage";
import ViewShot, { captureRef } from "react-native-view-shot";

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
        // Tab badge clears once the user actually opens this tab.
        await AsyncStorage.setItem(LAST_SEEN_WRAPPED_KEY, latest.week_start);
      }
      setVector(allTimeVec ?? null);
      if (allTimeVec) setIdentities(generateIdentitySet(allTimeVec, weekVec ?? undefined));
    } catch (e: any) {
      console.warn("wrapped load", e?.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function generate() {
    setLoading(true);
    try {
      const w = await generateForCurrentWeek();
      if (!w) {
        Alert.alert(
          "Nothing yet",
          "Add a visit or two this week and try again — we'll generate your Wrapped.",
        );
      } else {
        const wasFirstReveal = !data;
        setData(w);
        // Celebrate the moment — bigger burst on the first-ever Wrapped reveal.
        setConfettiKey((k) => k + 1);
        void track("wrapped_generated", { first_reveal: wasFirstReveal });
      }
    } catch (e: any) {
      Alert.alert("Couldn't generate", e.message ?? "Try again");
    } finally {
      setLoading(false);
    }
  }

  async function share() {
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
      // iOS share sheet lets the user pick Instagram (Stories), iMessage, etc.
      // Pre-rendered at 9:16 so IG accepts it as a story without cropping.
      await Share.share({ url: uri });
    } catch (e: any) {
      Alert.alert("Couldn't share", e.message ?? "Try again");
    }
  }

  async function shareToFeed() {
    if (!data) return;
    try {
      await shareWrappedToFeed({
        personaLabel: data.personality_label ?? "Your Palate",
        tagline: data.wrapped_json?.personality_label ?? "",
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

  return (
    <SafeAreaView style={styles.safe}>
      <Confetti fire={confettiKey > 0} count={180} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={type.title}>Your Wrapped</Text>
            <Text style={[type.body, { color: colors.mute, marginTop: 4 }]}>
              What your week says about how you eat.
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/insights")}
            style={styles.insightsBtn}
            accessibilityLabel="Open detailed insights"
          >
            <Text style={styles.insightsBtnText}>Insights →</Text>
          </Pressable>
        </View>
        <Spacer size={20} />

        {data ? (
          <>
            <ViewShot ref={cardRef as any} options={{ format: "png", quality: 1 }}>
              {/* Identity reveal is staged: stage 3 (3+ visits) gets the
                  dynamically composed persona; earlier stages see the stored
                  generic label. We're proving the system before explaining it. */}
              <WrappedCard
                data={data}
                personaOverride={stage >= 3 ? identities?.primary.label : undefined}
              />
            </ViewShot>
            {stage >= 3 && identities && vector && (
              <View style={styles.loreCard}>
                <Text style={styles.loreText}>{generateLore(vector, identities.primary)}</Text>
              </View>
            )}
            {stage < 3 && (
              <View style={styles.loreCard}>
                <Text style={styles.loreText}>
                  Your pattern is forming. The identity reveals at 3 visits.
                </Text>
              </View>
            )}
            {identities && (
              <View style={styles.identityFooter}>
                <View style={styles.identityFooterCol}>
                  <Text style={styles.identityFooterLabel}>ALSO</Text>
                  <Text style={styles.identityFooterValue}>{identities.secondary[0].label}</Text>
                </View>
                <View style={styles.identityFooterCol}>
                  <Text style={styles.identityFooterLabel}>AND</Text>
                  <Text style={styles.identityFooterValue}>{identities.secondary[1].label}</Text>
                </View>
                <View style={styles.identityFooterCol}>
                  <Text style={styles.identityFooterLabel}>THIS WEEK</Text>
                  <Text style={[styles.identityFooterValue, { color: colors.red }]}>
                    {identities.weeklyMood.label}
                  </Text>
                </View>
              </View>
            )}
            <WrappedCharts />
            <WeeklyPalateInsights weekStart={data.week_start} weekEnd={data.week_end} />
            <Spacer />
            <Button title="Post to Feed" onPress={shareToFeed} />
            <Spacer />
            <Button title="Share to Instagram Story" onPress={shareToStory} />
            <Spacer />
            <Button title="Share image" variant="ghost" onPress={share} />
            <Spacer />
            <Button title="Refresh" variant="ghost" onPress={generate} loading={loading} />

            {/* Off-screen render so view-shot can capture the 9:16 IG story
                version without affecting layout. */}
            <View style={{ position: "absolute", left: -9999, top: 0 }} pointerEvents="none">
              <View ref={storyRef as any} collapsable={false}>
                <WrappedStoryCard data={data} personaOverride={identities?.primary.label} />
              </View>
            </View>
          </>
        ) : identities && vector && vector.visitCount > 0 ? (
          // Week-1 mode: no weekly_wrapped row yet, but the user has visits.
          // Show the identity + lore + percentiles based on the vector so the
          // tab feels alive while we wait for Sunday.
          <>
            <View style={styles.preWrappedCard}>
              <Text style={styles.preEyebrow}>YOUR PALATE SO FAR</Text>
              <Text style={styles.prePrimary}>{identities.primary.label}</Text>
              <Text style={styles.preLore}>{generateLore(vector, identities.primary)}</Text>
              <View style={styles.prePill}>
                <Text style={styles.prePillText}>
                  Your first official Wrapped lands Sunday
                </Text>
              </View>
            </View>

            <PalateLoreCard primary={identities.primary} />
            <PercentileRow vector={vector} primary={identities.primary} />
            <CohortCard primary={identities.primary} vector={vector} />

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

// ============================================================================
// Wrapped sub-cards
// ============================================================================

function PalateLoreCard({ primary }: { primary: PalateIdentitySet["primary"] }) {
  const lore = expandedLore(primary);
  return (
    <View style={styles.loreExpanded}>
      <Text style={styles.loreEyebrow}>PALATE LORE</Text>
      <Text style={styles.loreSection}>What this means</Text>
      <Text style={styles.loreBody}>{lore.story}</Text>
      <Text style={styles.loreSection}>How {primary.label}s behave</Text>
      <Text style={styles.loreBody}>{lore.behavior}</Text>
    </View>
  );
}

function PercentileRow({
  vector, primary,
}: {
  vector: TasteVector;
  primary: PalateIdentitySet["primary"];
}) {
  const cards = generatePercentileCards(vector, primary);
  if (cards.length === 0) return null;
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={styles.percentileEyebrow}>WHERE YOU RANK · preview data</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingTop: 10 }}>
        {cards.map((c, i) => (
          <View key={i} style={styles.percentileCard}>
            <View style={{ flexDirection: "row", alignItems: "baseline" }}>
              <Text style={styles.percentileBig}>Top </Text>
              <AnimatedNumber value={c.percentile} suffix="%" duration={900} style={styles.percentileBig} />
            </View>
            <Text style={styles.percentileBody}>{c.body}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function CohortCard({
  primary, vector,
}: {
  primary: PalateIdentitySet["primary"];
  vector: TasteVector;
}) {
  const [c, setC] = useState<CohortInsight | null>(null);
  useEffectReact(() => {
    let alive = true;
    generateCohortInsightAsync(primary, vector).then((r) => { if (alive) setC(r); }).catch(() => {});
    return () => { alive = false; };
  }, [primary.label, vector.visitCount]);

  if (!c) return null;
  return (
    <View style={styles.cohortCard}>
      <Text style={styles.percentileEyebrow}>
        PEOPLE LIKE YOU{c.source === "preview" ? " · preview data" : ""}
      </Text>
      <Text style={styles.cohortBig}>{c.countLine}</Text>
      <Text style={styles.cohortLine}>· {c.paceLine}</Text>
      <Text style={styles.cohortLine}>· {c.citiesLine}</Text>
      <Text style={styles.cohortLine}>· {c.topSavedLine}</Text>
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
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  insightsBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  insightsBtnText: { fontSize: 13, fontWeight: "700", color: colors.ink },
  empty: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  loreCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  loreText: { fontSize: 16, fontWeight: "700", color: colors.ink, lineHeight: 22, fontStyle: "italic" },
  loreEvidence: { fontSize: 13, color: colors.mute, marginTop: 8, lineHeight: 18 },

  loreExpanded: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  loreEyebrow: { ...type.micro, color: colors.red },
  loreSection: { fontSize: 11, fontWeight: "800", color: colors.mute, letterSpacing: 1.3, marginTop: 14 },
  loreBody: { fontSize: 14, color: colors.ink, marginTop: 6, lineHeight: 20 },

  percentileEyebrow: { ...type.micro },
  percentileCard: {
    width: 200,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.ink,
  },
  percentileBig: {
    color: colors.red,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  percentileBody: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 6, lineHeight: 18 },

  cohortCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cohortBig: { fontSize: 20, fontWeight: "800", color: colors.ink, marginTop: 6, letterSpacing: -0.4 },
  cohortLine: { fontSize: 13, color: colors.ink, marginTop: 6, lineHeight: 18 },

  preWrappedCard: {
    padding: spacing.lg,
    borderRadius: 24,
    backgroundColor: colors.ink,
  },
  preEyebrow: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  prePrimary: {
    color: colors.red,
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.7,
    marginTop: 8,
    lineHeight: 34,
  },
  preLore: { color: "rgba(255,255,255,0.85)", fontSize: 15, marginTop: 12, lineHeight: 22, fontStyle: "italic" },
  prePill: {
    marginTop: 16,
    alignSelf: "flex-start",
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: "rgba(255,48,8,0.18)",
    borderWidth: 1, borderColor: "rgba(255,48,8,0.4)",
  },
  prePillText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  identityFooter: {
    marginTop: spacing.md,
    flexDirection: "row",
    gap: 8,
  },
  identityFooterCol: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  identityFooterLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.mute,
    letterSpacing: 1.3,
  },
  identityFooterValue: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.ink,
    marginTop: 4,
    lineHeight: 17,
  },
});
