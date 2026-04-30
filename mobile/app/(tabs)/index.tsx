import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Alert, ScrollView, RefreshControl, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Spacer } from "../../components/Button";
import { Wordmark } from "../../components/Logo";
import { colors, spacing, type } from "../../theme";
import { getCurrentLocation, logLocationEvent, requestForegroundPermission } from "../../lib/location";
import { nearbyRestaurants, type Restaurant } from "../../lib/places";
import { recentlyPrompted, recentVisits, type Visit } from "../../lib/visits";

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const v = await recentVisits(10);
      setVisits(v);
    } catch (e: any) {
      console.warn("load visits failed", e?.message);
    }
  }, []);

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
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <View style={styles.header}>
          <Wordmark />
        </View>

        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>RIGHT NOW</Text>
          <Text style={styles.heroTitle}>Are you eating somewhere?</Text>
          <Text style={styles.heroBody}>
            Tap to check what's around you. We'll ask before saving anything.
          </Text>
          <Spacer />
          <Button title={checking ? "Checking…" : "Check now"} onPress={handleCheckNow} loading={checking} />
        </View>

        <View style={{ marginTop: spacing.xxl }}>
          <Text style={type.title}>Recent</Text>
          <Spacer size={12} />
          {visits.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={type.subtitle}>No visits yet.</Text>
              <Text style={[type.small, { marginTop: 4 }]}>
                Tap "Check now" or use the + tab to add one manually.
              </Text>
            </View>
          ) : (
            visits.map((v) => <VisitRow key={v.id} v={v} />)
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function VisitRow({ v }: { v: Visit }) {
  const r = v.restaurant;
  const date = new Date(v.visited_at);
  return (
    <View style={styles.visit}>
      <View style={styles.visitDot} />
      <View style={{ flex: 1 }}>
        <Text style={styles.visitName}>{r?.name ?? "Unknown"}</Text>
        <Text style={type.small}>
          {date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ·{" "}
          {date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          {r?.primary_type ? ` · ${prettyType(r.primary_type)}` : ""}
        </Text>
      </View>
    </View>
  );
}

function prettyType(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { padding: spacing.lg, paddingBottom: 100 },
  header: { marginBottom: spacing.xl },
  heroCard: {
    backgroundColor: colors.faint,
    borderRadius: 24,
    padding: spacing.lg,
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
  visit: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    gap: 12,
  },
  visitDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.red,
  },
  visitName: { ...type.subtitle },
});
