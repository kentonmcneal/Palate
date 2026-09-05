import { useEffect, useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Text } from "./Text";
import { useRouter } from "expo-router";
import { colors, spacing, type, card, shadow } from "../theme";
import { loadAnalytics, type AnalyticsSummary } from "../lib/analytics-stats";
import { computeTasteVector } from "../lib/taste-vector";
import { onPersonalSignalInvalidate } from "../lib/personal-signal";
import { getProfileFromVector } from "../lib/palate/palateScoring";
import { IDENTITY_BLURB } from "../lib/palate/palateCopy";
import type { PrimaryIdentity } from "../lib/palate/palateTypes";
import { loadCompatiblePeople, compatibilityLine, type CompatiblePerson } from "../lib/social";
import { cuisineLabel } from "../lib/mood";
import { Avatar } from "./Avatar";

// ============================================================================
// AllTimeCard — the whole history, under the picks, on Home.
// ----------------------------------------------------------------------------
// The founder's ask: all-time visits, the breakdown by cuisine as bars, "You
// are a Forager", top cuisines on the left and the three people whose palate
// is closest on the right. It is the Spotify-Wrapped identity and the Strava
// comparison in one card, where you land instead of three tabs away.
//
// Everything here is already computed for Wrapped and the People screen; the
// card reads the same sources so the numbers agree with those screens.
// ============================================================================

export function AllTimeCard() {
  const router = useRouter();
  const [a, setA] = useState<AnalyticsSummary | null>(null);
  const [identity, setIdentity] = useState<PrimaryIdentity | null>(null);
  const [people, setPeople] = useState<CompatiblePerson[]>([]);
  const [failed, setFailed] = useState(false);

  // Reloads whenever the personal signal is invalidated (a visit logged or
  // deleted, a place hidden or restored), so the card never disagrees with
  // the week strip above it.
  const [tick, setTick] = useState(0);
  useEffect(() => onPersonalSignalInvalidate(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [analytics, vector, friends] = await Promise.all([
          loadAnalytics("all"),
          computeTasteVector().catch(() => null),
          loadCompatiblePeople(3).catch(() => [] as CompatiblePerson[]),
        ]);
        if (!alive) return;
        setA(analytics);
        setPeople(friends);
        if (vector && vector.visitCount >= 4) {
          const profile = await getProfileFromVector(vector).catch(() => null);
          if (alive && profile) setIdentity(profile.primaryIdentity);
        }
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [tick]);

  // No history is not an empty card; it is no card. Home has the activation
  // hero for that person.
  if (failed || !a || a.totalVisits === 0) return null;

  const cuisines = a.cuisineBreakdown.filter((c) => c.cuisine && c.cuisine !== "other").slice(0, 5);
  const max = Math.max(1, ...cuisines.map((c) => c.count));
  const blurb = identity ? IDENTITY_BLURB[identity] : null;

  return (
    <View style={styles.card}>
      <Pressable onPress={() => router.push("/(tabs)/wrapped" as never)} accessibilityRole="button">
        <View style={styles.head}>
          <Text style={styles.eyebrow}>ALL TIME</Text>
          <Text style={styles.link}>Wrapped →</Text>
        </View>
        <View style={styles.stats}>
          <Stat n={a.totalVisits} label={a.totalVisits === 1 ? "visit" : "visits"} />
          <Stat n={a.uniqueRestaurants} label={a.uniqueRestaurants === 1 ? "place" : "places"} />
          {a.topSpots[0] && (
            <View style={{ flex: 1.6 }}>
              <Text style={styles.statV} numberOfLines={1}>{a.topSpots[0].name}</Text>
              <Text style={styles.statL}>most visited · ×{a.topSpots[0].count}</Text>
            </View>
          )}
        </View>
      </Pressable>

      {cuisines.length > 0 && (
        <View style={styles.bars}>
          {cuisines.map((c) => (
            <View key={c.cuisine} style={styles.barRow}>
              <Text style={styles.barLabel} numberOfLines={1}>{cuisineLabel(c.cuisine)}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${Math.max(6, Math.round((c.count / max) * 100))}%` }]} />
              </View>
              <Text style={styles.barCount}>{c.count}</Text>
            </View>
          ))}
        </View>
      )}

      {identity && identity !== "Learning" && (
        <View style={styles.identity}>
          <Text style={styles.youAre}>You are {/^[AEIOU]/.test(identity) ? "an" : "a"} <Text style={styles.identityName}>{identity}</Text></Text>
          {blurb && <Text style={styles.tagline}>{blurb.tagline}</Text>}
        </View>
      )}

      <View style={styles.columns}>
        <View style={styles.col}>
          <Text style={styles.colHead}>Your cuisines</Text>
          {cuisines.slice(0, 3).map((c, i) => (
            <Text key={c.cuisine} style={styles.colLine} numberOfLines={1}>
              {i + 1}. {cuisineLabel(c.cuisine)} <Text style={styles.colMeta}>{Math.round(c.pct * 100)}%</Text>
            </Text>
          ))}
          {cuisines.length === 0 && <Text style={styles.colMeta}>Not enough tagged yet.</Text>}
        </View>
        <View style={styles.colRule} />
        <View style={styles.col}>
          <Text style={styles.colHead}>Closest palates</Text>
          {people.length === 0 && (
            <Text style={styles.colMeta}>Nobody overlaps you yet.</Text>
          )}
          {people.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => router.push(`/profile/${p.id}` as never)}
              style={styles.person}
              accessibilityRole="button"
            >
              <Avatar uri={p.avatar_url} name={p.display_name} size={24} />
              <View style={{ flex: 1 }}>
                <Text style={styles.personName} numberOfLines={1}>
                  {p.display_name || (p.username ? `@${p.username}` : "Someone")}
                </Text>
                <Text style={styles.personLine} numberOfLines={1}>{compatibilityLine(p)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.statV}>{n}</Text>
      <Text style={styles.statL}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.lg, padding: card.padding, borderRadius: card.radius, backgroundColor: colors.faint, ...shadow.card },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { ...type.micro },
  link: { fontSize: 13, fontWeight: "700", color: colors.red },
  stats: { flexDirection: "row", gap: 12, marginTop: 10 },
  statV: { fontSize: 20, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 },
  statL: { ...type.micro, marginTop: 2, fontSize: 10 },
  bars: { marginTop: 14, gap: 6 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { width: 92, fontSize: 12, fontWeight: "600", color: colors.ink },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.line, overflow: "hidden" },
  barFill: { height: 10, borderRadius: 5, backgroundColor: colors.red },
  barCount: { width: 24, textAlign: "right", fontSize: 12, fontWeight: "700", color: colors.mute },
  identity: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  youAre: { fontSize: 15, color: colors.ink },
  identityName: { fontWeight: "800", color: colors.red },
  tagline: { ...type.small, marginTop: 2 },
  columns: { flexDirection: "row", gap: 12, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  col: { flex: 1, gap: 6 },
  colRule: { width: 1, backgroundColor: colors.line },
  colHead: { ...type.micro, fontSize: 10, marginBottom: 2 },
  colLine: { fontSize: 13, fontWeight: "600", color: colors.ink },
  colMeta: { fontSize: 12, fontWeight: "500", color: colors.mute },
  person: { flexDirection: "row", alignItems: "center", gap: 8 },
  personName: { fontSize: 13, fontWeight: "700", color: colors.ink },
  personLine: { fontSize: 11, color: colors.mute },
});
