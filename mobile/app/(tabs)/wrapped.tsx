import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, Alert, ScrollView, Share, Pressable } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { LAST_SEEN_WRAPPED_KEY } from "./_layout";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { generateForCurrentWeek, latestWrapped, isoWeekStart, type Wrapped } from "../../lib/wrapped";
// Inline the constant to avoid eagerly evaluating wrapped-story.tsx on every
// app launch. The file is loaded lazily when the user actually navigates to it.
const STORY_LAST_SHOWN_KEY = "palate.wrappedStory.lastShownWeek";
import { WrappedCard } from "../../components/WrappedCard";
import { WrappedStoryCard } from "../../components/WrappedStoryCard";
import { WrappedCharts } from "../../components/WrappedCharts";
import { Confetti } from "../../components/Confetti";
import { shareWrappedToFeed } from "../../lib/feed";
import { track } from "../../lib/analytics";
import { computeTasteVector, type TasteVector } from "../../lib/taste-vector";
import { generateIdentitySet, generateLore, expandedLore, type PalateIdentitySet } from "../../lib/palate-labels";
import { getSessionStage, type SessionStage } from "../../lib/session-stage";
import { loadPersonalSignal } from "../../lib/personal-signal";
import { assembleGraph, composeWrapped, type WrappedSummary } from "../../lib/recommendation";
import { generatePercentileCards, generateCohortInsightAsync, type CohortInsight } from "../../lib/population-stats";
import { computeAspirationalPalate, type AspirationalPalate } from "../../lib/aspirational-palate";
import { getAreaPalates, type AreaPalateSummary } from "../../lib/area-palates";
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
  const [summary, setSummary] = useState<WrappedSummary | null>(null);
  // Inlined-from-insights-deep state. All four blocks now live on Wrapped.
  const [percentileCards, setPercentileCards] = useState<ReturnType<typeof generatePercentileCards>>([]);
  const [cohort, setCohort] = useState<CohortInsight | null>(null);
  const [aspirational, setAspirational] = useState<AspirationalPalate | null>(null);
  const [areaPalates, setAreaPalates] = useState<AreaPalateSummary | null>(null);
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
      const ids = allTimeVec ? generateIdentitySet(allTimeVec, weekVec ?? undefined) : null;
      if (ids) setIdentities(ids);
      // Compose canonical Wrapped summary from the weekly graph for the
      // exploration/repeat/comfort/stretch scores below.
      const personal = await loadPersonalSignal().catch(() => null);
      const weekGraph = assembleGraph(weekVec ?? null, personal);
      setSummary(composeWrapped(weekGraph));

      // Load all the deep-insights surfaces in parallel — these used to live
      // on /insights-deep, now they're inlined on Wrapped per spec.
      if (allTimeVec && ids) {
        const [pc, co, ap, ar] = await Promise.all([
          Promise.resolve(generatePercentileCards(allTimeVec, ids.primary)),
          generateCohortInsightAsync(ids.primary, allTimeVec).catch(() => null),
          computeAspirationalPalate().catch(() => null),
          getAreaPalates().catch(() => null),
        ]);
        setPercentileCards(pc);
        setCohort(co);
        setAspirational(ap);
        setAreaPalates(ar);
      }
    } catch (e: any) {
      console.warn("wrapped load", e?.message);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    refresh();
    // Wrapped ALWAYS opens via the 3-card story intro. The story is the
    // experience — Wrapped behind it is the resolution. Delay slightly so
    // the focus transition completes first, otherwise the push fights the
    // tab navigation.
    const t = setTimeout(() => router.push("/wrapped-story"), 80);
    return () => clearTimeout(t);
  }, [refresh, router]));

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
        {/* Header — calm, premium. No "Insights →" button anymore; insights
            are inlined directly below per spec. */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={type.title}>Your Wrapped</Text>
            <Text style={styles.subtitle}>What your week says about how you eat.</Text>
          </View>
          {/* Replay the 3-card story intro on demand. The story shows
              automatically once per ISO week; this button lets the user
              re-trigger it any time. */}
          <Pressable
            onPress={async () => {
              try { await AsyncStorage.removeItem(STORY_LAST_SHOWN_KEY); } catch {}
              router.push("/wrapped-story");
            }}
            style={styles.replayBtn}
          >
            <Text style={styles.replayBtnText}>Replay story</Text>
          </Pressable>
        </View>
        <Spacer size={16} />

        {data ? (
          <>
            {/* 1. Black hero — identity + stats + top spots + top cuisines. */}
            <ViewShot ref={cardRef as any} options={{ format: "png", quality: 1 }}>
              <WrappedCard
                data={data}
                personaOverride={identityLabel()}
                personaDescription={stage >= 3 && identities ? identities.primary.description : undefined}
                topCuisines={summary?.topCuisines.slice(0, 3).map((c) => ({
                  name: humanizeCuisine(c.name),
                  share: c.share,
                }))}
              />
            </ViewShot>

            {/* 2. Interactive charts — tap-to-focus donut + day-of-week bars.
                Charts come immediately after the hero per spec — no gray
                "WHY THIS WEEK" / "TRY NEXT" boxes between. */}
            <WrappedCharts />

            {/* 3. Palate Lore (was on /insights-deep) — story + behavior. */}
            {identities && stage >= 3 && (() => {
              const lore = expandedLore(identities.primary);
              return (
                <View style={styles.insightCard}>
                  <Text style={styles.insightEyebrow}>PALATE LORE</Text>
                  <Text style={styles.insightTitle}>{identities.primary.label}</Text>
                  <Text style={styles.insightBody}>{lore.story}</Text>
                  <Spacer size={10} />
                  <Text style={styles.insightBody}>{lore.behavior}</Text>
                </View>
              );
            })()}

            {/* 4. Where you rank (percentile cards) */}
            {percentileCards.length > 0 && (
              <View style={styles.insightCard}>
                <Text style={styles.insightEyebrow}>WHERE YOU RANK</Text>
                {percentileCards.map((c, i) => (
                  <View key={i} style={styles.rankRow}>
                    <Text style={styles.rankPct}>Top {c.percentile}%</Text>
                    <Text style={styles.rankBody}>{c.body}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* 5. People like you (cohort) */}
            {cohort && (
              <View style={styles.insightCard}>
                <Text style={styles.insightEyebrow}>
                  PEOPLE LIKE YOU{cohort.source === "preview" ? " · preview" : ""}
                </Text>
                <Text style={styles.insightTitle}>{cohort.countLine}</Text>
                <Text style={styles.insightBody}>· {cohort.paceLine}</Text>
                <Text style={styles.insightBody}>· {cohort.citiesLine}</Text>
                <Text style={styles.insightBody}>· {cohort.topSavedLine}</Text>
              </View>
            )}

            {/* 6. Your next era (aspirational) */}
            {aspirational && (
              <View style={[styles.insightCard, styles.darkCard]}>
                <Text style={[styles.insightEyebrow, { color: "rgba(255,255,255,0.6)" }]}>YOUR NEXT ERA</Text>
                <Text style={[styles.insightTitle, { color: "#fff" }]}>{aspirational.insight}</Text>
                {aspirational.topAspirationTags.length > 0 && (
                  <View style={styles.tagRow}>
                    {aspirational.topAspirationTags.slice(0, 4).map((t) => (
                      <View key={t.tag} style={styles.darkChip}>
                        <Text style={styles.darkChipText}>{t.tag.replace(/_/g, " ")}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* 7. Top palates in your area */}
            {areaPalates && areaPalates.palates.length > 0 && (
              <View style={styles.insightCard}>
                <Text style={styles.insightEyebrow}>
                  TOP PALATES IN {areaPalates.area.toUpperCase()}
                  {areaPalates.source === "preview" ? " · preview" : ""}
                </Text>
                {areaPalates.palates.map((p, i) => (
                  <View key={p.label} style={styles.rankRow}>
                    <Text style={styles.rankPct}>{i + 1}. {p.label}</Text>
                    <Text style={styles.rankBody}>{Math.round(p.share * 100)}%</Text>
                  </View>
                ))}
              </View>
            )}

            {/* 8. Actions */}
            <Spacer size={20} />
            <Button title="Share" onPress={shareImage} />
            <Spacer size={8} />
            <Button title="Post to Feed" variant="ghost" onPress={shareToFeed} />
            <Spacer size={8} />
            <Button title="Share to Instagram Story" variant="ghost" onPress={shareToStory} />
            <Spacer size={8} />
            <Button title="Refresh" variant="ghost" onPress={generate} loading={loading} />

            {/* Off-screen story renderer — kept hidden so view-shot can grab a
                9:16 IG variant without affecting on-screen layout. */}
            <View style={{ position: "absolute", left: -9999, top: 0 }} pointerEvents="none">
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

function humanizeCuisine(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
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
  subtitle: { ...type.body, color: colors.mute, marginTop: 4, lineHeight: 20 },
  insightsBtn: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  insightsBtnText: { fontSize: 13, fontWeight: "700", color: colors.ink },
  replayBtn: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  replayBtnText: { fontSize: 12, fontWeight: "700", color: colors.ink },

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
  insightEyebrow: { ...type.micro, color: colors.red },
  insightTitle: { fontSize: 18, fontWeight: "800", color: colors.ink, marginTop: 8, letterSpacing: -0.3, lineHeight: 24 },
  insightBody: { fontSize: 14, color: colors.ink, marginTop: 6, lineHeight: 20 },
  darkCard: { backgroundColor: colors.ink, borderColor: colors.ink },
  rankRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 8,
    borderTopColor: colors.line, borderTopWidth: 1,
  },
  rankPct: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.ink },
  rankBody: { fontSize: 13, color: colors.mute, marginLeft: 12 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  darkChip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
  },
  darkChipText: { color: "#fff", fontSize: 11, fontWeight: "700" },

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
