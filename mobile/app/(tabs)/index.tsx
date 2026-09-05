import { distanceKm } from "../../lib/match-score";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View, StyleSheet, Alert, ScrollView, RefreshControl, Pressable, Image, Share } from "react-native";
import { Text } from "../../components/Text";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import { Wordmark } from "../../components/Logo";
import { colors, spacing, type } from "../../theme";
import { getCurrentLocation, logLocationEvent, requestForegroundPermission, classifyAccuracy } from "../../lib/location";
import { nearbyRestaurants, type Restaurant } from "../../lib/places";
import { recentlyPrompted, recentVisits, type Visit } from "../../lib/visits";
import { openInAppleMaps } from "../../lib/maps";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import { computeStreak, type StreakInfo } from "../../lib/streak";
import { refreshDailyReminder } from "../../lib/notifications";
import { refreshWrappedTease } from "../../lib/wrapped-tease";
import { captureError } from "../../lib/observability";
import { postMilestoneAndNotify } from "../../lib/feed";
import { generateInviteLink } from "../../lib/referrals";
import { analyzeWeeklyPalate, daysUntilSundayWrap, leaningPersonality, type PalateInsight } from "../../lib/palate-insights";
import { isoWeekStart } from "../../lib/wrapped";
import { Confetti } from "../../components/Confetti";
import { LocationPill } from "../../components/LocationPill";
import { HomeHero, TrackingLine } from "../../components/HomeHero";
import { MoodRow } from "../../components/MoodRow";
import { RecommendationsCard } from "../../components/RecommendationsCard";
import { AllTimeCard } from "../../components/AllTimeCard";
import { Spacer } from "../../components/Button";
import { buildDishChips, palateRead, SURPRISE, type Mood, type MoodChip } from "../../lib/mood";
import { dishesNear, type DishCount } from "../../lib/cuisine-catalogue";
import { homeState, type HomeState } from "../../lib/home-state";
import { getInbox } from "../../lib/passive-confirm";
import { isPassiveOptedIn } from "../../lib/passive-capture";
import { hasAlways, currentPermissionState } from "../../lib/passive-permissions";
import { getGmailStatus } from "../../lib/gmail";
import { listFriends } from "../../lib/friends";
import { getEffectiveLocation } from "../../lib/browsing-location";
import { loadAnalytics } from "../../lib/analytics-stats";

const STREAK_MILESTONES = [7, 14, 30, 50, 100, 200, 365];

function milestoneFor(count: number): number | null {
  return STREAK_MILESTONES.includes(count) ? count : null;
}

// Pick up to 8 wishlist entries within ~15km of the current location. Older
// saves without coordinates pass through unconditionally. If no location is
// available, show the most recent saves (capped at 8) so the rail isn't empty.

export default function Home() {
  const router = useRouter();
  const [visits, setVisits] = useState<Visit[]>([]);
  // Only feeds NextStepCard — an account with no friends is a different
  // problem from an account with no visits, and the two need different advice.
  const [friendCount, setFriendCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [weekInsight, setWeekInsight] = useState<PalateInsight | null>(null);
  const [milestoneConfetti, setMilestoneConfetti] = useState(0);
  const [celebratedStreak, setCelebratedStreak] = useState<number | null>(null);
  // Saves-anchored shelves migrated from Discover. Both surface on Home so the
  // decision engine has personal-intent context one tap away.
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);

  // Mood: a temporary cuisine override for tonight. Deliberately not
  // persisted — it is about this meal, not a preference.

  // What the hero chose, so the list below never repeats it.


  useEffect(() => {
    let alive = true;
    void listFriends()
      .then((f) => { if (alive) setFriendCount(f.length); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // What Home is about right now. Null until the first load resolves, so the
  // screen never flashes a wrong state before it knows the real one.
  const { mood: moodParam } = useLocalSearchParams<{ mood?: string }>();
  const [mood, setMood] = useState<Mood>(null);
  const [moodChips, setMoodChips] = useState<MoodChip[]>([]);
  // Cuisines available nearby, reported up by the recommendations card so a
  // cuisine the user has never eaten is still offerable.
  const [nearbyPool, setNearbyPool] = useState<Array<{ cuisine_type?: string | null }>>([]);
  const [myCuisines, setMyCuisines] = useState<any[]>([]);
  const [palateLine, setPalateLine] = useState<string | null>(null);
  const [habitualCuisines, setHabitualCuisines] = useState<string[]>([]);
  const [home, setHome] = useState<HomeState | null>(null);
  const [trackingOn, setTrackingOn] = useState(false);
  const [lastCheck, setLastCheck] = useState<string | null>(null);

  // What Home is about right now. Assembled from free reads only — a local
  // permission check, the local inbox, and one RPC. Nothing here touches Gmail
  // or Google Places, because this runs on every foreground.
  // The cuisine chips are built from a month of the user's own visits, so the
  // moods offered are things they actually eat rather than a fixed menu.
  useEffect(() => {
    let alive = true;
    loadAnalytics("month")
      .then((a) => {
        if (!alive) return;
        setMyCuisines(a.cuisineBreakdown);
        setPalateLine(palateRead(a.cuisineBreakdown));
        setHabitualCuisines(
          a.cuisineBreakdown.filter((c) => c.count >= 2).slice(0, 3).map((c) => c.cuisine),
        );
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // The dishes around you, from the catalogue, for the browsing city. Free.
  const [dishes, setDishes] = useState<DishCount[]>([]);
  useEffect(() => {
    if (!here) return;
    let alive = true;
    void dishesNear(here.lat, here.lng)
      .then((d) => { if (alive) setDishes(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [here?.lat, here?.lng]);

  useEffect(() => {
    setMoodChips(buildDishChips(myCuisines, nearbyPool, dishes));
  }, [myCuisines, nearbyPool, dishes]);

  // The Thursday nudge deep-links in with ?mood=surprise.
  useEffect(() => {
    if (moodParam === "surprise") setMood(SURPRISE);
  }, [moodParam]);

  const loadHomeState = useCallback(async (visitCount: number, friends: number) => {
    const [inbox, perms, gmail, optedIn] = await Promise.all([
      getInbox().catch(() => []),
      currentPermissionState().catch(() => ({ whenInUse: false, always: false })),
      getGmailStatus().catch(() => ({
        connected: false, email: null, last_scanned_at: null, imported_count: 0,
      })),
      isPassiveOptedIn().catch(() => false),
    ]);
    const always = perms.always || (await hasAlways().catch(() => false));
    const on = optedIn && always;

    setTrackingOn(on);
    setLastCheck(
      on
        ? new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        : null,
    );
    setHome(homeState({
      pending: inbox.map((e: { name?: string }) => ({ name: e.name ?? "" })),
      activation: {
        locationAlways: perms.always,
        locationWhenInUse: perms.whenInUse,
        gmailConnected: gmail.connected,
        gmailImported: gmail.imported_count,
        visitCount,
        friendCount: friends,
      },
      trackingOn: on,
    }));
  }, []);

  const load = useCallback(async () => {
    // Location resolves alongside the independent fetches below; the saves rail
    // then runs WITH it so matches stay local (no out-of-town recs for
    // out-of-town saves).
    const locP = getEffectiveLocation().catch(() => null);
    const [v, s, w] = await Promise.allSettled([
      // Sixty rather than ten: the week strip and the Saturday tease both
      // read the current week from this list, and ten is not a week.
      recentVisits(60),
      computeStreak(),
      loadCurrentWeekInsight(),
    ]);
    if (v.status === "fulfilled") setVisits(v.value);
    // The hero decides what this whole screen is about, so it must not wait on
    // the recommendation fetches below it.
    void loadHomeState(
      v.status === "fulfilled" ? v.value.length : 0,
      friendCount,
    ).catch((e) => captureError(e, { at: "loadHomeState" }));
    if (s.status === "fulfilled") {
      setStreak(s.value);
      // Re-engagement: schedule (or clear) tonight's streak-at-risk nudge.
      // Guarded: a rejection in the notification-scheduling path must not escape
      // as an unhandled fatal (see _layout startup effect for why that crashes).
      void refreshDailyReminder({ loggedToday: s.value.loggedToday, streak: s.value.current, visitCount: v.status === "fulfilled" ? v.value.length : undefined })
        .catch((e) => captureError(e, { at: "refreshDailyReminder" }));
      // Saturday 18:30: the week's numbers, and that Wrapped is in tomorrow.
      if (v.status === "fulfilled") {
        void refreshWrappedTease(v.value)
          .catch((e) => captureError(e, { at: "refreshWrappedTease" }));
      }
      // Fire confetti once per session when the user crosses a milestone day.
      const m = milestoneFor(s.value.current);
      if (m && celebratedStreak !== m) {
        setMilestoneConfetti((k) => k + 1);
        setCelebratedStreak(m);
        void celebrateMilestone(m).catch((e) => captureError(e, { at: "celebrateMilestone" }));
      }
    }
    if (w.status === "fulfilled") setWeekInsight(w.value);
    const loc = await locP;
    const hereLoc = loc ?? null;
    setHere(hereLoc ? { lat: hereLoc.lat, lng: hereLoc.lng } : null);
    // The saves rail, the wishlist rail and the mood row moved to Discover, so
    // their fetches go with them. Leaving them running would cost an RPC, a
    // hydrate query and a wishlist read on every foreground to render nothing.
  }, [celebratedStreak, friendCount, loadHomeState]);

  useFocusEffect(
    useCallback(() => {
      void load().catch((e) => captureError(e, { at: "home:load" }));
    }, [load]),
  );

  // A streak milestone just got crossed: push it to the friend feed (once,
  // deduped across app restarts) and offer to share it — which doubles as an
  // invite, since the share carries the user's referral link.
  async function celebrateMilestone(days: number) {
    try {
      const key = "palate.lastMilestonePosted";
      const last = await AsyncStorage.getItem(key);
      if (last !== String(days)) {
        await postMilestoneAndNotify(days);
        await AsyncStorage.setItem(key, String(days));
      }
    } catch {
      // Feed post is best-effort — never block the celebration on it.
    }
    Alert.alert(
      `🔥 ${days}-day streak!`,
      "You're officially in the habit. Share it and see who can keep up.",
      [
        { text: "Not now", style: "cancel" },
        { text: "Share", onPress: () => void shareStreak(days) },
      ],
    );
  }

  async function shareStreak(days: number) {
    try {
      const link = await generateInviteLink();
      await Share.share({
        message: `${days} days straight logging every meal on Palate 🔥 Think you can out-streak me?\n\n${link}`,
      });
    } catch {
      // user cancelled or share unavailable — no-op
    }
  }


  return (
    <SafeAreaView style={styles.safe}>
      <Confetti fire={milestoneConfetti > 0} count={150} />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <View style={styles.header}>
          <Wordmark />
          <View style={styles.headerActions}>
            {/* The streak chip is gone from Home on the founder's call. The
                streak itself still drives the evening reminder and the
                milestone posts; it just no longer sits in the header as a
                number to protect. */}
            <Pressable
              onPress={() => router.push("/(tabs)/add")}
              style={styles.addBtn}
              accessibilityLabel="Add a visit"
            >
              <Text style={styles.addBtnText}>+</Text>
            </Pressable>
          </View>
        </View>

        {/* Browsing-location toggle. Lets users plan trips to other cities
            without breaking visit-logging (which still uses real GPS). */}
        <View style={{ marginBottom: spacing.md }}>
          <LocationPill />
        </View>

        {/* HOME = WHAT ARE YOU IN THE MOOD FOR.
            The hero states the one thing only when there IS one — visits to
            confirm, or an account that cannot do anything yet. Most of the time
            there is nothing to finish, and on those days Home is a decision:
            pick a mood, get the best place for it.

            The mood row was on this screen before tonight and I removed it in
            the redesign, which was wrong — it is the only control here that
            asks what the user wants RIGHT NOW rather than inferring it from
            what they did last month.

            RightNowHero is gone rather than sitting above this: it and the
            first ranked pick were repeatedly the same restaurant, which was
            raised as a bug, and a mood-driven list answers the same question
            with the user's own input attached. */}
        {home && (home.kind === "review" || home.kind === "activation") && (
          <HomeHero state={home} />
        )}

        <View style={styles.homeRule} />

        <Text style={styles.moodHead}>What are you in the mood for?</Text>
        {!!palateLine && <Text style={styles.palateRead}>{palateLine}</Text>}
        <MoodRow chips={moodChips} value={mood} onChange={setMood} />
        <RecommendationsCard
          mood={mood}
          habitualCuisines={habitualCuisines}
          excludePlaceIds={[]}
          onCuisinesAvailable={setNearbyPool}
        />

        {/* All time, under the picks: visits, cuisines as bars, who you are,
            and the three palates closest to yours. */}
        <AllTimeCard />

        <TrackingLine on={trackingOn} lastCheck={lastCheck} />


      </ScrollView>
    </SafeAreaView>
  );
}

async function loadCurrentWeekInsight(): Promise<PalateInsight | null> {
  try {
    const start = isoWeekStart();
    const end = new Date().toISOString().slice(0, 10);
    return await analyzeWeeklyPalate(start, end);
  } catch {
    return null;
  }
}

function StreakChip({ count, loggedToday }: { count: number; loggedToday: boolean }) {
  // Constant pulse felt like noise. Now: static at rest. The "at risk" color
  // change alone is enough signal — the chip turns gray when the streak's
  // about to break.
  return (
    <View style={[styles.streakChip, !loggedToday && styles.streakChipAtRisk]}>
      <Text style={styles.streakEmoji}>🔥</Text>
      <Text style={[styles.streakText, !loggedToday && styles.streakTextAtRisk]}>
        {count}
      </Text>
    </View>
  );
}

function WeekSoFarCard({ insight, onPress }: { insight: PalateInsight; onPress: () => void }) {
  const leaning = leaningPersonality(insight);
  const days = daysUntilSundayWrap();
  const cuisineLabel = insight.primaryCuisine
    ? insight.primaryCuisine[0].toUpperCase() + insight.primaryCuisine.slice(1).replace("-", " ")
    : null;

  const countdown =
    days === 0 ? "Wrapped lands today"
    : days === 1 ? "Wrapped lands tomorrow"
    : `${days} days until Wrapped`;

  return (
    <Pressable onPress={onPress} style={styles.weekCard} accessibilityRole="button">
      <Text style={styles.weekEyebrow}>YOUR WEEK SO FAR</Text>
      <View style={styles.weekRow}>
        <View style={styles.weekStat}>
          <AnimatedNumber value={insight.visitCount} duration={650} style={styles.weekStatValue} />
          <Text style={styles.weekStatLabel}>visits</Text>
        </View>
        {cuisineLabel && (
          <View style={styles.weekStat}>
            <Text style={styles.weekStatValue}>{cuisineLabel}</Text>
            <Text style={styles.weekStatLabel}>cuisine</Text>
          </View>
        )}
        {leaning && (
          <View style={[styles.weekStat, { flex: 1.2 }]}>
            <Text style={[styles.weekStatValue, { color: colors.red }]} numberOfLines={1}>{leaning}</Text>
            <Text style={styles.weekStatLabel}>trending</Text>
          </View>
        )}
      </View>
      <Text style={styles.weekCountdown}>{countdown} · tap to open →</Text>
    </Pressable>
  );
}

function VisitRow({ v, onPress, onLongPress }: { v: Visit; onPress: () => void; onLongPress: () => void }) {
  const r = v.restaurant;
  const date = new Date(v.visited_at);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [styles.visitCard, pressed && { opacity: 0.6 }]}
      accessibilityHint="Tap for details · long-press to delete"
    >
      {v.photo_url ? (
        <Image source={{ uri: v.photo_url }} style={styles.visitCardThumb} />
      ) : (
        <View style={styles.visitCardThumbEmpty}>
          <Text style={styles.visitCardThumbInitial}>
            {(r?.name ?? "?")[0].toUpperCase()}
          </Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.visitCardName} numberOfLines={1}>{r?.name ?? "Unknown"}</Text>
        <Text style={[type.small, { marginTop: 3 }]}>
          {date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · {date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </Text>
        {(r?.cuisine_type || r?.neighborhood) && (
          <Text style={[type.small, { marginTop: 3, color: colors.mute }]} numberOfLines={1}>
            {[r?.cuisine_type ? prettyType(r.cuisine_type) : null, r?.neighborhood].filter(Boolean).join(" · ")}
          </Text>
        )}
      </View>
      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          if (r?.name) openInAppleMaps(r.name, { address: r.address, lat: r.latitude, lng: r.longitude });
        }}
        style={styles.visitMapsBtn}
        accessibilityLabel="Open in Maps"
      >
        <Text style={styles.visitMapsBtnText}>Maps</Text>
      </Pressable>
    </Pressable>
  );
}

function prettyType(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const styles = StyleSheet.create({
  moodHead: {
    ...type.title, fontSize: 21, lineHeight: 25,
    color: colors.ink, letterSpacing: -0.4, marginBottom: 4,
  },
  palateRead: { ...type.small, marginBottom: 10, lineHeight: 18 },
  homeRule: {
    height: 1, backgroundColor: colors.line,
    marginTop: spacing.lg, marginBottom: spacing.lg,
  },
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { padding: spacing.lg, paddingBottom: 100 },
  header: {
    marginBottom: spacing.xl,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.ink,
    alignItems: "center", justifyContent: "center",
  },
  addBtnText: { color: "#fff", fontSize: 22, fontWeight: "800", marginTop: -2 },
  streakChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  streakChipAtRisk: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
  },
  streakEmoji: { fontSize: 14 },
  streakText: { color: colors.ink, fontWeight: "800", fontSize: 14 },
  streakTextAtRisk: { color: colors.mute },
  weekCard: {
    marginBottom: spacing.xl,
    padding: spacing.md,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  weekEyebrow: { ...type.micro },
  weekRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 14,
  },
  weekStat: { flex: 1 },
  weekStatValue: { fontSize: 18, fontWeight: "800", color: colors.ink },
  weekStatLabel: { ...type.small, marginTop: 2 },
  weekCountdown: {
    marginTop: 12,
    color: colors.mute,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
  },

  visitCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  visitCardThumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: colors.faint },
  visitCardThumbEmpty: {
    width: 56, height: 56, borderRadius: 12,
    backgroundColor: colors.faint,
    alignItems: "center", justifyContent: "center",
  },
  visitCardThumbInitial: { fontSize: 20, fontWeight: "800", color: colors.mute },
  visitCardName: { fontSize: 16, fontWeight: "700", color: colors.ink },
  visitMapsBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  visitMapsBtnText: { fontSize: 12, fontWeight: "700", color: colors.ink },
});
