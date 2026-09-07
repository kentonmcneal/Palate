import { useCallback, useRef, useState } from "react";
import { LoadError } from "../../components/LoadError";
import { View, StyleSheet, Alert, ScrollView, Share, Pressable } from "react-native";
import { Text } from "../../components/Text";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { LAST_SEEN_WRAPPED_KEY } from "./_layout";
import { Button, Spacer } from "../../components/Button";
import { wrappedPromise } from "../../lib/next-step";
import { visitsToWrapped } from "../../lib/visits";
import { colors, spacing, type } from "../../theme";
import { generateForCurrentWeek, currentWrapped, isoWeekStart, type Wrapped } from "../../lib/wrapped";
import { allTimeStats, weekIsWorthShowing } from "../../lib/wrapped-scope";
import { loadAnalytics, type AnalyticsSummary } from "../../lib/analytics-stats";
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
import {
  getProfileFromVector, IDENTITY_BLURB, composeEgoHook,
  type PalateProfile, type PrimaryIdentity,
} from "../../lib/palate";
import { identityName, displayStoredPersona } from "../../lib/palate";
import { storedPersonaKey } from "../../lib/palate/palateNames";
import { composeLearningLine } from "../../lib/palate/palateCopy";
import { tagLabel } from "../../lib/palate/palateTags";
import { supabase } from "../../lib/supabase";
import { WhatArePalates } from "../../components/WhatArePalates";
import { SharePalateCard, type ShareStat } from "../../components/SharePalateCard";
import ViewShot, { captureRef } from "react-native-view-shot";
import { generateInviteLink, inviteShareMessage } from "../../lib/referrals";

// ============================================================================
// Wrapped — REFLECTION ONLY. One job: tell me what kind of eater I am.
// Layout (in order):
//   1. Hero card: identity badge ("Explorer") with its one-line meaning under
//      it, all-time stats, top spots, top cuisines
//   2. This week's numbers
//   3. Charts
//   4. What are Palates? explainer + share actions
// Every identity name on this screen is followed by what it means. A name on
// its own reads as jargon to anyone who has not used the app.
// ============================================================================

// Module-scope flag — survives component remounts. Without this, the Wrapped
// tab re-mounts every time the story screen pops back via router.replace,
// which would reset a useRef and re-trigger the story → infinite loop.
let storyShownThisSession = false;

// The gate lives in lib/visits.ts; derive it rather than restating it, so the
// promise on this screen can never drift from the rule that unlocks it.
const VISITS_FOR_WRAPPED = visitsToWrapped(0);

export default function WrappedTab() {
  const [data, setData] = useState<Wrapped | null>(null);
  const [profile, setProfile] = useState<PalateProfile | null>(null);
  // The week's visit count, for the line under "Warming Up": it says the
  // number the person has and the number they need.
  const [weekVisits, setWeekVisits] = useState<number>(0);
  const [vector, setVector] = useState<TasteVector | null>(null);
  const [, setStage] = useState<SessionStage>(1);
  const [summary, setSummary] = useState<WrappedSummary | null>(null);
  // Area palates is the only "deep" surface that still renders on the tab —
  // identity / signals / behavior / dishes / percentile / cohort / next era
  // all moved into the Wrapped Story (app/wrapped-story.tsx).
  const [loading, setLoading] = useState(false);
  const [confettiKey, setConfettiKey] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const cardRef = useRef<View>(null);
  // All-time totals, for the hero. The week keeps its own section below.
  const [allTime, setAllTime] = useState<AnalyticsSummary | null>(null);
  // Separate from `profile`, which is the WEEK's lean and drives the "this week
  // leaned" block lower down. The hero is about who you are, not this week.
  const [allTimeProfile, setAllTimeProfile] = useState<PalateProfile | null>(null);
  const storyRef = useRef<View>(null);
  const palateShareRef = useRef<View>(null);
  // (storyShownThisSession lives at module scope above — see comment there.)
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const [latest, allTimeVec, weekVec, st, analytics] = await Promise.all([
        // Regenerates when what is stored is not this week — the Sunday cron
        // writes once a week, so every meal after it was invisible until the
        // next Sunday.
        currentWrapped(),
        computeTasteVector().catch(() => null),
        computeTasteVector({ sinceDays: 7 }).catch(() => null),
        getSessionStage().catch(() => 1 as SessionStage),
        loadAnalytics("all").catch(() => null),
      ]);
      setAllTime(analytics);
      setStage(st);
      setData(latest);
      if (latest?.week_start) {
        await AsyncStorage.setItem(LAST_SEEN_WRAPPED_KEY, latest.week_start);
      }
      setVector(allTimeVec ?? null);
      setWeekVisits(weekVec?.visitCount ?? 0);
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

        // Tell the server which identity this actually is. Until 0118 the
        // server minted its own five names from a CASE statement, so Wrapped
        // said "Explorer" and the profile said "The Fast Casual Regular" about
        // the same week. This is the write that makes them agree — best
        // effort, and never allowed to take the tab down.
        if (latest?.week_start && newProfile.primaryIdentity !== "Learning") {
          void supabase.rpc("set_palate_identity", {
            p_week_start: latest.week_start,
            p_identity: identityName(newProfile.primaryIdentity),
            p_tagline: IDENTITY_BLURB[newProfile.primaryIdentity].tagline,
          }).then(() => {}, () => {});
        }
      }
      // The hero identity, from the whole history. A week vector of two visits
      // resolves to "Learning" however long you have been using the app, which
      // is exactly wrong on a card that is now about all of it.
      if (allTimeVec) {
        const p = await getProfileFromVector(allTimeVec).catch(() => null);
        if (p) setAllTimeProfile(p);
      }

      // Top Palates in <city> is off the tab (founder's call, 2026-09-05).
      // At 14 testers it read "preview" over a distribution of four accounts,
      // which is a claim about a city made from almost nobody. The idea is
      // parked in docs/IDEAS.md with the number that would earn it back.
      setError(null);
    } catch (e: any) {
      // A Wrapped that failed to load used to render the sample card under
      // "No Wrapped yet", which tells somebody thirty visits in that the app
      // has nothing on them.
      setError(e ?? new Error("wrapped load failed"));
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

  async function inviteFriend() {
    try {
      const link = await generateInviteLink();
      await Share.share({ message: inviteShareMessage(link) });
      void track("wrapped_invite_shared");
    } catch (e: any) {
      Alert.alert("Couldn't share", e.message ?? "Try again");
    }
  }

  /** The hero's identity: all-time, falling back to the week if unavailable. */
  function allTimeIdentityLabel(): string {
    if (allTimeProfile) return identityName(allTimeProfile.primaryIdentity);
    return identityLabel();
  }

  function identityLabel(): string {
    // The client-side Palate identity wins when available — single source of
    // truth. `personality_label` is what the server wrote, which for rows
    // older than 0118 is one of five names this app no longer uses, so it is
    // mapped home rather than shown raw.
    if (profile) return identityName(profile.primaryIdentity);
    const stored = displayStoredPersona(data?.personality_label);
    if (stored) return stored;
    return identityName("Learning");
  }

  /** The identity key behind the week's label, so its meaning can sit under it. */
  function weekIdentityKey(): PrimaryIdentity | null {
    if (profile) return profile.primaryIdentity;
    return storedPersonaKey(data?.personality_label);
  }

  /** The hero's identity key: all-time, falling back to the week. */
  function heroIdentityKey(): PrimaryIdentity | null {
    return allTimeProfile?.primaryIdentity ?? weekIdentityKey();
  }

  /** A name on its own is jargon. Every card that shows one puts this under it. */
  function taglineFor(key: PrimaryIdentity | null): string | undefined {
    return key ? IDENTITY_BLURB[key].tagline : undefined;
  }

  function insightLine(): string {
    // The profile's explanation is plain prose about what the person did.
    // Below the naming threshold it is replaced by the count they have and
    // the count they need, which is the only thing they can act on.
    if (profile && profile.primaryIdentity !== "Learning") return profile.explanation;
    return composeLearningLine(weekVisits);
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
            <Text style={styles.subtitle}>Everywhere you've eaten, and what it says.</Text>
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

        {!data && error ? (
          <LoadError error={error} onRetry={() => { setError(null); void refresh(); }} />
        ) : data ? (
          <>
            {/* 1. Black hero — identity + stats + top spots + top cuisines.
                Identity name is now Curator/Forager/Steward/Anchor (or
                Learning when <4 visits). Description comes from the new
                IDENTITY_BLURB. */}
            <ViewShot ref={cardRef as any} options={{ format: "png", quality: 1 }}>
              <WrappedCard
                data={data}
                // Leads with the accumulated history. A single week reads as
                // "2 visits" to somebody thirty restaurants in, which is true
                // and tells them nothing about what the app has built.
                stats={allTime ? allTimeStats(allTime) : undefined}
                personaOverride={allTimeIdentityLabel()}
                // Whatever produced the name above, its meaning goes under it,
                // including "Not enough visits to say yet" for a thin history.
                personaDescription={taglineFor(heroIdentityKey())}
                // All-time as well, or the card would mix scopes: lifetime
                // visits and places above a week's worth of cuisines.
                topCuisines={
                  allTime
                    ? allTime.cuisineBreakdown
                        .filter((c) => c.cuisine && c.cuisine !== "other")
                        .slice(0, 3)
                        .map((c) => ({ name: humanizeCuisine(c.cuisine), share: c.pct }))
                    : summary?.topCuisines.slice(0, 3).map((c) => ({
                        name: humanizeCuisine(c.name),
                        share: c.share,
                      }))
                }
              />
            </ViewShot>

            {/* The deep narrative pieces (ego hook, interpretation, signals,
                behavior, top dish, percentile, cohort, next era) now live
                EXCLUSIVELY in the Wrapped Story (app/wrapped-story.tsx),
                rendered up to 5 Spotify-Wrapped-style cards. The Wrapped tab
                stays scannable: share card, charts, area palates, explainer. */}

            {/* The week as a section under it, not as the headline. Hidden
                entirely when nothing was logged — a block reading "0 visits"
                is worse than no block. */}
            {weekIsWorthShowing(data.total_visits) && (
              <View style={styles.weekBlock}>
                <Text style={styles.weekEyebrow}>THIS WEEK</Text>
                <Text style={styles.weekRange}>
                  {new Date(data.week_start).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  {" – "}
                  {new Date(data.week_end).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </Text>
                <View style={styles.weekStats}>
                  <View style={styles.weekStat}>
                    <Text style={styles.weekStatValue}>{data.total_visits}</Text>
                    <Text style={styles.weekStatLabel}>visits</Text>
                  </View>
                  <View style={styles.weekStat}>
                    <Text style={styles.weekStatValue}>{data.unique_restaurants}</Text>
                    <Text style={styles.weekStatLabel}>places</Text>
                  </View>
                  {!!data.top_restaurant && (
                    <View style={[styles.weekStat, { flex: 2 }]}>
                      <Text style={styles.weekStatValue} numberOfLines={1}>{data.top_restaurant}</Text>
                      <Text style={styles.weekStatLabel}>most visited</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Interactive charts — tap-to-focus donut + day-of-week bars */}
            <WrappedCharts />

            {/* What are Palates? — explainer block with axis graph + share CTA */}
            {profile && <WhatArePalates profile={profile} onShare={sharePalate} />}

            {/* 8. Actions */}
            <Spacer size={20} />
            {/* Primary share — the new 9:16 SharePalateCard. Only shown for
                classified users; "Learning" users have nothing meaningful to
                share yet. */}
            {/* One share, not four.
                sharePalate, shareImage and shareToStory were the same
                mechanic — captureRef into the system share sheet — differing
                only in WHICH hidden view they photographed. That is a
                designer's decision handed to the person using the app, who
                cannot see the difference between "Share your Palate", "Share
                Wrapped card" and "Share to Instagram Story" until after they
                have picked one. Two of the seven buttons here even carried the
                same words, because the explainer card above renders its own.
                The story card is the one drawn at 9:16 to be posted, so that
                is the one that goes.
                Post to Feed and Invite are kept: different destination,
                different action. Refresh is a quiet link now — it was
                competing for attention with the reason the screen exists. */}
            {profile && profile.primaryIdentity !== "Learning" && (
              <>
                <Button title="Share your Wrapped" onPress={sharePalate} />
                <Spacer size={8} />
              </>
            )}
            <Button title="Post to Feed" variant="ghost" onPress={shareToFeed} />
            <Spacer size={8} />
            <Button title="Invite a friend to compare palates" onPress={inviteFriend} />
            <Spacer size={12} />
            <Pressable onPress={generate} hitSlop={10} accessibilityRole="button">
              <Text style={styles.quietAction}>{loading ? "Refreshing…" : "Refresh"}</Text>
            </Pressable>

            {/* Off-screen renderers — kept hidden so view-shot can grab them
                without affecting on-screen layout. Story = legacy 9:16 card.
                PalateShare = new design-bible 9:16 card. */}
            <View style={{ position: "absolute", left: -9999, top: 0 }} pointerEvents="none">
              <View ref={storyRef as any} collapsable={false}>
                <WrappedStoryCard data={data} personaOverride={identityLabel()} personaDescription={taglineFor(weekIdentityKey())} />
              </View>
              {profile && profile.primaryIdentity !== "Learning" && (
                <View ref={palateShareRef as any} collapsable={false} style={{ marginTop: 24 }}>
                  <SharePalateCard
                    identity={profile.primaryIdentity}
                    weekRange={formatWeekRange(data.week_start, data.week_end)}
                    stats={buildShareStats(data)}
                    // Tag keys stay internal; the card shows the plain phrase.
                    tags={profile.tags.slice(0, 3).map(tagLabel)}
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
              <Text style={styles.identityEyebrow}>YOUR PALATE THIS WEEK</Text>
              <Text style={styles.identityName}>{identityLabel()}</Text>
              {/* The name is a badge. This is what it means, on the same card. */}
              <Text style={styles.identityTagline}>{taglineFor(weekIdentityKey())}</Text>
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
              <WrappedCard data={SAMPLE_WRAPPED} personaDescription={IDENTITY_BLURB.Anchor.tagline} />
            </View>
            <Spacer />
            <View style={styles.empty}>
              <Text style={type.subtitle}>No Wrapped yet</Text>
              {/* Say what it will be and exactly what it needs. "Log your
                  first visit and we'll start reading your pattern" promises
                  nothing a person can picture, and gives them no number. */}
              <Text style={[type.body, { color: colors.mute, marginTop: 6, lineHeight: 21 }]}>
                {wrappedPromise(vector?.visitCount ?? 0, VISITS_FOR_WRAPPED)}
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
  return `${fmt(startISO)} to ${fmt(endISO)}`;
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

// The preview shows one of the app's real identity names with its meaning,
// not the retired server-minted "The Fast Casual Regular".
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
  personality_label: "The Regular",
  wrapped_json: {
    total_visits: 12,
    unique_restaurants: 7,
    top_restaurant: "Sweetgreen",
    top_category: "fast_casual",
    repeat_rate: 0.42,
    personality_label: "The Regular",
    top_three: [
      { name: "Sweetgreen", count: 4 },
      { name: "Joe & The Juice", count: 2 },
      { name: "Joe's Pizza", count: 2 },
    ],
  },
};

const styles = StyleSheet.create({
  weekBlock: {
    marginTop: spacing.lg, padding: spacing.lg, borderRadius: 20,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  weekEyebrow: { ...type.micro },
  weekRange: { ...type.small, marginTop: 2 },
  weekStats: { flexDirection: "row", gap: 16, marginTop: 14 },
  weekStat: { flex: 1 },
  weekStatValue: { fontSize: 24, fontWeight: "800", color: colors.ink, letterSpacing: -0.6 },
  weekStatLabel: { ...type.small, marginTop: 2 },
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
  replayBtnText: { fontSize: 13, fontWeight: "700", color: colors.ink },

  identityCard: {
    padding: spacing.lg,
    borderRadius: 22,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "flex-start",
  },
  identityEyebrow: { color: colors.mute, fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  identityName: {
    color: colors.red,
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -0.7,
    lineHeight: 38,
    marginTop: 6,
  },
  identityTagline: { ...type.body, color: colors.mute, marginTop: 6, lineHeight: 20 },

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
    fontSize: 28,
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
  // Was italic. No Inter italic face is loaded, so iOS answered that with the
  // system font and this one line on Wrapped sat in a different typeface.
  insightText: { fontSize: 16, color: colors.ink, lineHeight: 21, fontWeight: "500" },
  insightEyebrow: { ...type.micro, color: colors.mute },
  insightTitle: { fontSize: 18, fontWeight: "800", color: colors.ink, marginTop: 8, letterSpacing: -0.3, lineHeight: 24 },
  insightBody: { fontSize: 13, color: colors.ink, marginTop: 6, lineHeight: 20 },
  darkCard: { backgroundColor: colors.ink, borderColor: colors.ink },
  rankRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 8,
    borderTopColor: colors.line, borderTopWidth: 1,
  },
  rankPct: { flex: 1, fontSize: 13, fontWeight: "700", color: colors.ink },
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
  tagChipText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
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
  dishName: { fontSize: 13, fontWeight: "700", color: colors.ink },
  dishWhere: { fontSize: 13, color: colors.mute, marginTop: 2 },

  deepLink: {
    paddingVertical: 12,
    alignItems: "center",
  },
  deepLinkText: { color: colors.red, fontSize: 13, fontWeight: "700" },

  preWaitPill: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  preWaitText: { color: colors.ink, fontSize: 13, fontWeight: "700" },

  // Refresh is maintenance, not the point of the screen. A full-width button
  // gave it the same weight as sharing, which is the one thing this tab exists
  // to make easy.
  quietAction: {
    textAlign: "center", paddingVertical: 10,
    fontSize: 13, fontWeight: "600", color: colors.mute,
  },
  empty: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
});
