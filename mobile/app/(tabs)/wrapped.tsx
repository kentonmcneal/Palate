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
import { getSessionStage, type SessionStage } from "../../lib/session-stage";
import { loadPersonalSignal } from "../../lib/personal-signal";
import { assembleGraph, composeWrapped, type WrappedSummary } from "../../lib/recommendation";
import { getAreaPalates, type AreaPalateSummary } from "../../lib/area-palates";
import {
  getProfileFromVector, IDENTITY_BLURB, composeEgoHook,
  type PalateProfile,
} from "../../lib/palate";
import { WhatArePalates } from "../../components/WhatArePalates";
import { SharePalateCard, type ShareStat } from "../../components/SharePalateCard";
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

// Module-scope flag — survives component remounts. Without this, the Wrapped
// tab re-mounts every time the story screen pops back via router.replace,
// which would reset a useRef and re-trigger the story → infinite loop.
let storyShownThisSession = false;

export default function WrappedTab() {
  const [data, setData] = useState<Wrapped | null>(null);
  const [profile, setProfile] = useState<PalateProfile | null>(null);
  const [vector, setVector] = useState<TasteVector | null>(null);
  const [, setStage] = useState<SessionStage>(1);
  const [summary, setSummary] = useState<WrappedSummary | null>(null);
  // Area palates is the only "deep" surface that still renders on the tab —
  // identity / signals / behavior / dishes / percentile / cohort / next era
  // all moved into the Wrapped Story (app/wrapped-story.tsx).
  const [areaPalates, setAreaPalates] = useState<AreaPalateSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [confettiKey, setConfettiKey] = useState(0);
  const cardRef = useRef<View>(null);
  const storyRef = useRef<View>(null);
  const palateShareRef = useRef<View>(null);
  // (storyShownThisSession lives at module scope above — see comment there.)
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
      const personal = await loadPersonalSignal().catch(() => null);
      const weekGraph = assembleGraph(weekVec ?? null, personal);
      setSummary(composeWrapped(weekGraph));

      // Palate identity — single source of truth, used for the share card
      // hero copy + the WhatArePalates explainer placement on this tab.
      if (weekVec) {
        const newProfile = await getProfileFromVector(weekVec, {
          thisWeekIso: isoWeekStart(),
        });
        setProfile(newProfile);
      }

      // Area palates still renders on the tab. Everything else (percentile,
      // cohort, aspirational, top dishes) moved to the Wrapped Story.
      const ar = await getAreaPalates().catch(() => null);
      setAreaPalates(ar);
    } catch (e: any) {
      console.warn("wrapped load", e?.message);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    refresh();
    // Story plays once per ISO week, AND only once per app session (whichever
    // is more restrictive). Two gates:
    //   • Module-scope flag — prevents re-push when the story screen exits
    //     and re-mounts this tab.
    //   • AsyncStorage(STORY_LAST_SHOWN_KEY) — prevents re-firing every cold
    //     launch within the same week. Written by wrapped-story on dismiss.
    if (storyShownThisSession) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        const lastShown = await AsyncStorage.getItem(STORY_LAST_SHOWN_KEY);
        if (cancelled) return;
        if (lastShown === isoWeekStart()) {
          // Already showed this week — set the session flag so the manual
          // Replay button is the only way back in.
          storyShownThisSession = true;
          return;
        }
        storyShownThisSession = true;
        timer = setTimeout(() => router.push("/wrapped-story"), 80);
      } catch {
        // If AsyncStorage fails, fall back to "show on first focus this session"
        storyShownThisSession = true;
        timer = setTimeout(() => router.push("/wrapped-story"), 80);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
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

  async function sharePalate() {
    if (!palateShareRef.current) {
      Alert.alert("Not ready yet", "Give it a moment and try again.");
      return;
    }
    try {
      const uri = await captureRef(palateShareRef, { format: "png", quality: 1 });
      await Share.share({ url: uri, message: "My Palate this week" });
      void track("palate_share_card_exported");
    } catch (e: any) {
      Alert.alert("Couldn't share", e.message ?? "Try again");
    }
  }

  async function shareToFeed() {
    if (!data) return;
    try {
      await shareWrappedToFeed({
        personaLabel: identityLabel(),
        tagline: profile && profile.primaryIdentity !== "Learning"
          ? IDENTITY_BLURB[profile.primaryIdentity].tagline
          : "",
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
    // New Palate identity (Curator/Forager/Steward/Anchor/Learning) wins
    // when available — single source of truth.
    if (profile) return profile.primaryIdentity;
    if (data?.personality_label) return data.personality_label;
    return "Learning";
  }

  function insightLine(): string {
    // Use the profile's composed explanation — already handles soft language
    // for middle users + Learning state for low-data.
    if (profile) return profile.explanation;
    return "We're still learning your Palate. Log a few more visits and we'll show you who you eat like.";
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
            onPress={() => {
              // Manual re-trigger. Flag stays true so we don't re-loop on
              // the next focus.
              storyShownThisSession = true;
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
            {/* 1. Black hero — identity + stats + top spots + top cuisines.
                Identity name is now Curator/Forager/Steward/Anchor (or
                Learning when <4 visits). Description comes from the new
                IDENTITY_BLURB. */}
            <ViewShot ref={cardRef as any} options={{ format: "png", quality: 1 }}>
              <WrappedCard
                data={data}
                personaOverride={identityLabel()}
                personaDescription={profile && profile.primaryIdentity !== "Learning"
                  ? IDENTITY_BLURB[profile.primaryIdentity].tagline
                  : undefined}
                topCuisines={summary?.topCuisines.slice(0, 3).map((c) => ({
                  name: humanizeCuisine(c.name),
                  share: c.share,
                }))}
              />
            </ViewShot>

            {/* The deep narrative pieces (ego hook, interpretation, signals,
                behavior, top dish, percentile, cohort, next era) now live
                EXCLUSIVELY in the Wrapped Story (app/wrapped-story.tsx),
                rendered up to 5 Spotify-Wrapped-style cards. The Wrapped tab
                stays scannable: share card, charts, area palates, explainer. */}

            {/* Interactive charts — tap-to-focus donut + day-of-week bars */}
            <WrappedCharts />

            {/* Top palates in your area */}
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

            {/* What are Palates? — explainer block with axis graph + share CTA */}
            {profile && <WhatArePalates profile={profile} onShare={sharePalate} />}

            {/* 8. Actions */}
            <Spacer size={20} />
            {/* Primary share — the new 9:16 SharePalateCard. Only shown for
                classified users; "Learning" users have nothing meaningful to
                share yet. */}
            {profile && profile.primaryIdentity !== "Learning" && (
              <>
                <Button title="Share your Palate" onPress={sharePalate} />
                <Spacer size={8} />
              </>
            )}
            <Button title="Share Wrapped card" variant="ghost" onPress={shareImage} />
            <Spacer size={8} />
            <Button title="Post to Feed" variant="ghost" onPress={shareToFeed} />
            <Spacer size={8} />
            <Button title="Share to Instagram Story" variant="ghost" onPress={shareToStory} />
            <Spacer size={8} />
            <Button title="Refresh" variant="ghost" onPress={generate} loading={loading} />

            {/* Off-screen renderers — kept hidden so view-shot can grab them
                without affecting on-screen layout. Story = legacy 9:16 card.
                PalateShare = new design-bible 9:16 card. */}
            <View style={{ position: "absolute", left: -9999, top: 0 }} pointerEvents="none">
              <View ref={storyRef as any} collapsable={false}>
                <WrappedStoryCard data={data} personaOverride={identityLabel()} />
              </View>
              {profile && profile.primaryIdentity !== "Learning" && (
                <View ref={palateShareRef as any} collapsable={false} style={{ marginTop: 24 }}>
                  <SharePalateCard
                    identity={profile.primaryIdentity}
                    weekRange={formatWeekRange(data.week_start, data.week_end)}
                    stats={buildShareStats(data)}
                    tags={profile.tags.slice(0, 3)}
                    egoHook={composeEgoHook(profile)}
                  />
                </View>
              )}
            </View>
          </>
        ) : profile && vector && vector.visitCount > 0 ? (
          // Pre-Sunday: visits exist but no Wrapped row yet. Show a stripped
          // version so the tab feels alive while the user waits for Sunday.
          <>
            <View style={styles.identityCard}>
              <Text style={styles.identityEyebrow}>YOUR PALATE THIS WEEK LEANED</Text>
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

const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function formatWeekRange(startISO: string, endISO: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return iso;
    return `${SHORT_MONTHS[m - 1]} ${d}`;
  };
  return `${fmt(startISO)} — ${fmt(endISO)}`;
}

function buildShareStats(w: Wrapped): ShareStat[] {
  const out: ShareStat[] = [
    { label: "Visits", value: String(w.total_visits ?? 0) },
    { label: "Places", value: String(w.unique_restaurants ?? 0) },
  ];
  if (typeof w.repeat_rate === "number") {
    out.push({ label: "Repeat", value: `${Math.round(w.repeat_rate * 100)}%` });
  }
  return out;
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
    // Subtle brand-text glow per redesign brief — restrained, not blooming.
    textShadowColor: "rgba(255,48,8,0.28)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
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

  tagRowLight: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  tagChip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  tagChipText: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  // Dominant (first) tag gets the headline treatment per design bible.
  dominantTag: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.6,
    marginTop: 8,
  },
  // Ego hook — small, premium, sits right under the black hero card.
  egoHook: {
    color: colors.red,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.3,
    textTransform: "uppercase",
    marginTop: spacing.md,
    marginLeft: 4,
    // Restrained glow — was 0.55. Reads as brand accent, not blooming text.
    textShadowColor: "rgba(255,48,8,0.28)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },

  insightCardSubtle: { backgroundColor: colors.faint },
  dishRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 10,
    borderTopColor: colors.line, borderTopWidth: 1,
  },
  dishHeart: { color: colors.red, fontSize: 18, fontWeight: "800" },
  dishName: { fontSize: 14, fontWeight: "700", color: colors.ink },
  dishWhere: { fontSize: 12, color: colors.mute, marginTop: 2 },

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
