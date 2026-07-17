import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Alert, ScrollView, RefreshControl, Pressable, Image, Animated, Easing, Share } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Spacer } from "../../components/Button";
import { Wordmark } from "../../components/Logo";
import { colors, spacing, type } from "../../theme";
import { getCurrentLocation, logLocationEvent, requestForegroundPermission, classifyAccuracy } from "../../lib/location";
import { nearbyRestaurants, type Restaurant } from "../../lib/places";
import { recentlyPrompted, recentVisits, deleteVisitWithUndo, type Visit } from "../../lib/visits";
import { openInAppleMaps } from "../../lib/maps";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import { computeStreak, type StreakInfo } from "../../lib/streak";
import { refreshDailyReminder } from "../../lib/notifications";
import { postMilestoneAndNotify } from "../../lib/feed";
import { generateInviteLink } from "../../lib/referrals";
import {
  analyzeWeeklyPalate,
  daysUntilSundayWrap,
  leaningPersonality,
  type PalateInsight,
} from "../../lib/palate-insights";
import { isoWeekStart } from "../../lib/wrapped";
import { RecommendationsCard } from "../../components/RecommendationsCard";
import { GettingStarted } from "../../components/GettingStarted";
import { Confetti } from "../../components/Confetti";
import { LocationPill } from "../../components/LocationPill";
import { RightNowHero } from "../../components/RightNowHero";
import { StretchPick } from "../../components/StretchPick";
import { WishlistRail } from "../../components/WishlistRail";
import { BasedOnSaves, BasedOnSavesEmpty } from "../../components/BasedOnSaves";
import { listWishlist, type WishlistEntry } from "../../lib/palate-insights";
import { loadRecsFromSaves, type SaveAnchoredRec } from "../../lib/recs-from-saves";
import { getEffectiveLocation } from "../../lib/browsing-location";
import { distanceKm } from "../../lib/match-score";

const STREAK_MILESTONES = [7, 14, 30, 50, 100, 200, 365];

function milestoneFor(count: number): number | null {
  return STREAK_MILESTONES.includes(count) ? count : null;
}

// Pick up to 8 wishlist entries within ~15km of the current location. Older
// saves without coordinates pass through unconditionally. If no location is
// available, show the most recent saves (capped at 8) so the rail isn't empty.
function filterWishlistForHere(
  wish: WishlistEntry[],
  here: { lat: number; lng: number } | null,
): WishlistEntry[] {
  if (!here) return wish.slice(0, 8);
  return wish
    .filter((w) => {
      const r = w.restaurant;
      if (!r) return false;
      if (r.latitude == null || r.longitude == null) return true;
      return distanceKm(here, { lat: r.latitude, lng: r.longitude }) < 15;
    })
    .slice(0, 8);
}

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [weekInsight, setWeekInsight] = useState<PalateInsight | null>(null);
  const [milestoneConfetti, setMilestoneConfetti] = useState(0);
  const [celebratedStreak, setCelebratedStreak] = useState<number | null>(null);
  // Saves-anchored shelves migrated from Discover. Both surface on Home so the
  // decision engine has personal-intent context one tap away.
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [wishlistRail, setWishlistRail] = useState<WishlistEntry[]>([]);
  const [hasAnySaves, setHasAnySaves] = useState<boolean | null>(null);
  const [savesAnchors, setSavesAnchors] = useState<Array<{ id: string; name: string }>>([]);
  const [savesRecs, setSavesRecs] = useState<SaveAnchoredRec[]>([]);

  const load = useCallback(async () => {
    // Location resolves alongside the independent fetches below; the saves rail
    // then runs WITH it so matches stay local (no out-of-town recs for
    // out-of-town saves).
    const locP = getEffectiveLocation().catch(() => null);
    const [v, s, w, wish] = await Promise.allSettled([
      recentVisits(10),
      computeStreak(),
      loadCurrentWeekInsight(),
      listWishlist(),
    ]);
    if (v.status === "fulfilled") setVisits(v.value);
    if (s.status === "fulfilled") {
      setStreak(s.value);
      // Re-engagement: schedule (or clear) tonight's streak-at-risk nudge.
      void refreshDailyReminder({ loggedToday: s.value.loggedToday, streak: s.value.current });
      // Fire confetti once per session when the user crosses a milestone day.
      const m = milestoneFor(s.value.current);
      if (m && celebratedStreak !== m) {
        setMilestoneConfetti((k) => k + 1);
        setCelebratedStreak(m);
        void celebrateMilestone(m);
      }
    }
    if (w.status === "fulfilled") setWeekInsight(w.value);
    const loc = await locP;
    const hereLoc = loc ?? null;
    setHere(hereLoc ? { lat: hereLoc.lat, lng: hereLoc.lng } : null);
    if (wish.status === "fulfilled") {
      setHasAnySaves(wish.value.length > 0);
      setWishlistRail(filterWishlistForHere(wish.value, hereLoc));
    } else {
      setHasAnySaves(false);
      setWishlistRail([]);
    }
    // Saves rail — location-aware so matches stay near the user.
    try {
      const saves = await loadRecsFromSaves(
        hereLoc ? { here: { lat: hereLoc.lat, lng: hereLoc.lng } } : {},
      );
      setSavesAnchors(saves.anchors);
      setSavesRecs(saves.recs);
    } catch {
      setSavesAnchors([]);
      setSavesRecs([]);
    }
  }, [celebratedStreak]);

  useFocusEffect(
    useCallback(() => {
      load();
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

        {/* HOME = DECISION ENGINE. Strict order per spec:
            1. What should I eat right now (DOMINANT)
            2. Places you'll probably like
            3. One place to stretch your palate
            4. Saved restaurants
            (Recent stays at the bottom as a lightweight diary peek.)
            Analysis lives on Profile → Insights. Reflection lives on Wrapped. */}

        {/* 1. The dominant decision card. */}
        <RightNowHero />

        {/* 2. Visible "Are you eating somewhere?" entry — auto-detect path is
            the primary way to log a visit. Demoting it to a tiny ghost link
            killed visit logging — back to a real button. */}
        <View style={styles.checkNowCard}>
          <Text style={styles.checkNowEyebrow}>ARE YOU EATING SOMEWHERE?</Text>
          <Spacer size={8} />
          <Button
            title={checking ? "Checking…" : "Check now"}
            onPress={handleCheckNow}
            loading={checking}
          />
        </View>

        {/* Saved places near here (rail). Moved up from Discover so saves
            stay one tap away from the decision engine. */}
        <WishlistRail
          items={wishlistRail}
          here={here}
          onTap={(gpid) => router.push(`/restaurant/${gpid}` as any)}
        />

        {/* "Because you saved X, Y, Z" — directly addresses the burger-feedback
            loop problem: surfaces things similar to user's HIGH-INTENT signal
            (saves), not their latest visits. Shows empty-state nudge when
            the user has zero saves yet. */}
        {savesRecs.length > 0 ? (
          <BasedOnSaves
            anchors={savesAnchors}
            recs={savesRecs}
            onTap={(gpid) => router.push(`/restaurant/${gpid}` as any)}
          />
        ) : hasAnySaves === false ? (
          <BasedOnSavesEmpty />
        ) : null}

        {/* 3. Places you'll probably like — 3 picks. */}
        <Text style={styles.sectionHead}>Places you'll probably like</Text>
        <RecommendationsCard />

        {/* 4. One stretch pick — explicitly its own block AFTER the recs. */}
        <Text style={styles.sectionHead}>Stretch your palate</Text>
        <StretchPick />

        {/* Saved restaurants moved to Profile per spec — Home stays decision-only. */}

        {visits.length === 0 && (
          <View style={{ marginTop: spacing.xxl }}>
            <GettingStarted />
          </View>
        )}

        <View style={{ marginTop: spacing.xxl }}>
          <View style={styles.recentHead}>
            <Text style={type.title}>Recent</Text>
            {visits.length > 0 && (
              <Pressable onPress={() => router.push("/all-visits")}>
                <Text style={styles.viewAll}>View all →</Text>
              </Pressable>
            )}
          </View>
          <Spacer size={12} />
          {visits.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={[type.small, { lineHeight: 20 }]}>
                Logged visits show up here. Each one sharpens your weekly Wrapped.
              </Text>
            </View>
          ) : (
            visits.map((v) => (
              <VisitRow
                key={v.id}
                v={v}
                onPress={() => router.push(`/visit/${v.id}`)}
                onLongPress={() => {
                  Alert.alert(
                    "Delete this visit?",
                    `${v.restaurant?.name ?? "Unknown"} on ${new Date(v.visited_at).toLocaleDateString()}`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: async () => {
                          try {
                            const removed = v;
                            const { undo } = await deleteVisitWithUndo(v.id);
                            setVisits((curr) => curr.filter((x) => x.id !== v.id));
                            // 6-second undo window via Alert
                            Alert.alert(
                              "Visit deleted",
                              `Removed ${removed.restaurant?.name ?? "visit"}.`,
                              [
                                { text: "OK", style: "default" },
                                {
                                  text: "Undo",
                                  onPress: async () => {
                                    try {
                                      await undo();
                                      setVisits((curr) => [removed, ...curr]);
                                    } catch (e: any) {
                                      Alert.alert("Couldn't undo", e?.message ?? "Try again");
                                    }
                                  },
                                },
                              ],
                            );
                          } catch (e: any) {
                            Alert.alert("Couldn't delete", e.message ?? "Try again");
                          }
                        },
                      },
                    ],
                  );
                }}
              />
            ))
          )}
        </View>
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
          if (r?.name) openInAppleMaps(r.name, r.neighborhood ?? null);
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
  heroCard: {
    backgroundColor: colors.faint,
    borderRadius: 24,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  heroEyebrow: { ...type.micro },
  heroTitle: { ...type.title, marginTop: 6 },
  heroBody: { ...type.body, color: colors.mute, marginTop: 6, lineHeight: 22 },

  sectionHead: {
    fontSize: 18, fontWeight: "800", color: colors.ink,
    letterSpacing: -0.3,
    marginTop: spacing.xl,
    marginBottom: 12,  // positive margin so descenders don't get clipped by next card
    paddingBottom: 4,
  },
  checkNowCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  checkNowEyebrow: { ...type.micro, color: colors.mute },
  emptyCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
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
  recentHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  viewAll: { color: colors.redText, fontSize: 13, fontWeight: "700" },
});
