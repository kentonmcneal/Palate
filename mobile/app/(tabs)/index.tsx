import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Alert, ScrollView, RefreshControl, Pressable, Image, Animated, Easing } from "react-native";
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
import {
  analyzeWeeklyPalate,
  daysUntilSundayWrap,
  leaningPersonality,
  type PalateInsight,
} from "../../lib/palate-insights";
import { isoWeekStart } from "../../lib/wrapped";
import { RecommendationsCard } from "../../components/RecommendationsCard";
import { SavedNearbyCard } from "../../components/SavedNearbyCard";
import { GettingStarted } from "../../components/GettingStarted";
import { Confetti } from "../../components/Confetti";
import { LocationPill } from "../../components/LocationPill";

const STREAK_MILESTONES = [7, 14, 30, 50, 100, 200, 365];

function milestoneFor(count: number): number | null {
  return STREAK_MILESTONES.includes(count) ? count : null;
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

  const load = useCallback(async () => {
    // All three are independent — fetch in parallel so the screen renders fast.
    const [v, s, w] = await Promise.allSettled([
      recentVisits(10),
      computeStreak(),
      loadCurrentWeekInsight(),
    ]);
    if (v.status === "fulfilled") setVisits(v.value);
    if (s.status === "fulfilled") {
      setStreak(s.value);
      // Fire confetti once per session when the user crosses a milestone day.
      const m = milestoneFor(s.value.current);
      if (m && celebratedStreak !== m) {
        setMilestoneConfetti((k) => k + 1);
        setCelebratedStreak(m);
      }
    }
    if (w.status === "fulfilled") setWeekInsight(w.value);
  }, [celebratedStreak]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

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
          "Can't quite see you",
          "Your location signal is fuzzy right now — usually means you're indoors or moving. Step outside or try again in a minute.",
        );
        return;
      }
      const places = await nearbyRestaurants(loc.lat, loc.lng);
      await logLocationEvent(loc, places[0]?.google_place_id ?? null);

      if (!places.length) {
        Alert.alert("Nothing nearby", "We don't see a restaurant near you right now.");
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

        {/* HOME = DECISION ONLY. Four sections, in this order:
            Hero → Most Compatible → Places you've been meaning to go → Recent.
            Analysis lives on Profile → Insights. Reflection lives on Wrapped. */}
        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>RIGHT NOW</Text>
          <Text style={styles.heroTitle}>Where are you eating?</Text>
          <Spacer />
          <Button title={checking ? "Checking…" : "Check now"} onPress={handleCheckNow} loading={checking} />
        </View>

        <RecommendationsCard />

        <SavedNearbyCard />

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
    backgroundColor: colors.red,
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
    backgroundColor: "#FFF1EE",
    borderWidth: 1,
    borderColor: "#FFD7CE",
  },
  streakChipAtRisk: {
    backgroundColor: colors.faint,
    borderColor: colors.line,
  },
  streakEmoji: { fontSize: 14 },
  streakText: { color: colors.red, fontWeight: "800", fontSize: 14 },
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
    backgroundColor: "#FFF1EE",
    alignItems: "center", justifyContent: "center",
  },
  visitCardThumbInitial: { fontSize: 20, fontWeight: "800", color: colors.red },
  visitCardName: { fontSize: 16, fontWeight: "700", color: colors.ink },
  visitMapsBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  visitMapsBtnText: { fontSize: 12, fontWeight: "700", color: colors.ink },
  recentHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  viewAll: { color: colors.red, fontSize: 13, fontWeight: "700" },
});
