import { distanceKm } from "../../lib/match-score";
import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Alert, ScrollView, RefreshControl, Pressable, Image, Share } from "react-native";
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
import { captureError } from "../../lib/observability";
import { postMilestoneAndNotify } from "../../lib/feed";
import { generateInviteLink } from "../../lib/referrals";
import { analyzeWeeklyPalate, daysUntilSundayWrap, leaningPersonality, type PalateInsight } from "../../lib/palate-insights";
import { isoWeekStart } from "../../lib/wrapped";
import { Confetti } from "../../components/Confetti";
import { LocationPill } from "../../components/LocationPill";
import { RightNowHero } from "../../components/RightNowHero";
import { HomeHero, TrackingLine } from "../../components/HomeHero";
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
  const [checking, setChecking] = useState(false);
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
  const [heroPlaceId, setHeroPlaceId] = useState<string | null>(null);


  useEffect(() => {
    let alive = true;
    void listFriends()
      .then((f) => { if (alive) setFriendCount(f.length); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // What Home is about right now. Null until the first load resolves, so the
  // screen never flashes a wrong state before it knows the real one.
  const [home, setHome] = useState<HomeState | null>(null);
  const [trackingOn, setTrackingOn] = useState(false);
  const [lastCheck, setLastCheck] = useState<string | null>(null);

  // What Home is about right now. Assembled from free reads only — a local
  // permission check, the local inbox, and one RPC. Nothing here touches Gmail
  // or Google Places, because this runs on every foreground.
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
      recentVisits(10),
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
      void refreshDailyReminder({ loggedToday: s.value.loggedToday, streak: s.value.current })
        .catch((e) => captureError(e, { at: "refreshDailyReminder" }));
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
      "You're officially in the habit. Share it — and see who can keep up.",
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

  async function handleCheckNow() {
    setChecking(true);
    try {
      const perm = await requestForegroundPermission();
      if (!perm.granted) {
        Alert.alert("Location off", "Turn on location in Settings → Palate.");
        return;
      }

      const loc = await getCurrentLocation();
      const confidence = classifyAccuracy(loc.accuracy);
      if (confidence === "low") {
        Alert.alert(
          "We couldn't confidently detect a restaurant nearby.",
          "Your location signal is fuzzy right now — usually means you're indoors or moving. Step outside or try again in a minute.",
        );
        return;
      }
      const places = await nearbyRestaurants(loc.lat, loc.lng);
      await logLocationEvent(loc, places[0]?.google_place_id ?? null);

      if (!places.length) {
        Alert.alert(
          "We couldn't confidently detect a restaurant nearby.",
          "If you're sure you're at one, you can log it manually from the + button.",
        );
        return;
      }

      // Pick the first place we haven't recently asked about.
      let target: Restaurant | undefined;
      for (const p of places) {
        const wasAsked = await recentlyPrompted(p.google_place_id);
        if (!wasAsked) {
          target = p;
          break;
        }
      }
      target = target ?? places[0];

      router.push({
        pathname: "/confirm-visit",
        params: {
          place_id: target.google_place_id,
          name: target.name,
          address: target.address ?? "",
          alternates: JSON.stringify(places.slice(0, 6).filter((p) => p.google_place_id !== target!.google_place_id)),
          confidence,
        },
      });
    } catch (e: any) {
      Alert.alert("Couldn't check right now", e.message ?? "Try again");
    } finally {
      setChecking(false);
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
            {streak && streak.current > 0 && <StreakChip count={streak.current} loggedToday={streak.loggedToday} />}
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

        {/* HOME ANSWERS ONE QUESTION.
            It used to open with five blocks of equal weight — a right-now hero,
            a mood row, three picks, a stretch pick, a saves rail, a recent list
            — and leave the reader to work out which mattered. At 9pm with two
            unreviewed visits, nothing else on this screen is worth looking at.

            homeState() picks the one thing, and everything above the fold
            follows from it. What left Home did not disappear:
              Recent            -> the Visits tab
              Places you'll like -> Discover, "For you"
              Stretch pick      -> Discover, sorted "Something different"
              Based on saves    -> Discover, "Only places I've saved"
              Saved rail        -> Discover filter, and Profile
            Each has one home instead of two, which is how the profile drift
            got fixed and the same reason applies here. */}
        {home && <HomeHero state={home} />}

        {/* One recommendation, not six. */}
        <View style={styles.homeRule} />
        <Text style={styles.sectionHead}>
          {new Date().getHours() >= 21 ? "Still open near you" : "If you're deciding now"}
        </Text>
        <RightNowHero onPicked={setHeroPlaceId} />

        <TrackingLine on={trackingOn} lastCheck={lastCheck} />

        {/* The manual path stays reachable and stops defining the screen. */}
        <Pressable onPress={handleCheckNow} style={styles.checkNowGhost} accessibilityRole="button">
          <Text style={styles.checkNowGhostText}>
            {checking ? "Checking…" : "Eating somewhere right now? Check →"}
          </Text>
        </Pressable>

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
  homeRule: {
    height: 1, backgroundColor: colors.line,
    marginTop: spacing.lg, marginBottom: spacing.lg,
  },
  checkNowGhost: { paddingVertical: 14, alignItems: "center" },
  checkNowGhostText: { fontSize: 13, fontWeight: "700", color: colors.redText },
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

  sectionHead: {
    fontSize: 18, fontWeight: "800", color: colors.ink,
    letterSpacing: -0.3,
    marginTop: spacing.xl,
    marginBottom: 12,  // positive margin so descenders don't get clipped by next card
    paddingBottom: 4,
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
