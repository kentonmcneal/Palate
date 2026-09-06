import { useEffect, useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Text } from "./Text";
import { useRouter } from "expo-router";
import { colors, spacing, type, card, shadow } from "../theme";
import { loadAnalytics, type AnalyticsSummary } from "../lib/analytics-stats";
import { loadCompatiblePeople, type CompatiblePerson } from "../lib/social";
import { onPersonalSignalInvalidate } from "../lib/personal-signal";
import { cuisineLabel } from "../lib/mood";
import { Avatar } from "./Avatar";

// ============================================================================
// ProfileColumns — the three things a profile is actually for.
// ----------------------------------------------------------------------------
// Left:   your three most-visited places. Ties break on recency, because two
//         places you have been three times each are not equally yours — the
//         one you were at last week is.
// Middle: your three biggest cuisines.
// Right:  the three people whose palate is closest to yours.
//
// Everything here already exists elsewhere in the app (the Wrapped analytics
// and the People screen's compatibility RPC), so the numbers agree with those
// screens by construction rather than by coincidence.
//
// Three narrow columns on a phone is tight, so each cell is one line of name
// and one line of number. Anything longer belongs on the screen it links to.
// ============================================================================

export function ProfileColumns() {
  const router = useRouter();
  const [a, setA] = useState<AnalyticsSummary | null>(null);
  const [people, setPeople] = useState<CompatiblePerson[]>([]);
  const [failed, setFailed] = useState(false);

  const [tick, setTick] = useState(0);
  useEffect(() => onPersonalSignalInvalidate(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [analytics, friends] = await Promise.all([
          loadAnalytics("all"),
          loadCompatiblePeople(3).catch(() => [] as CompatiblePerson[]),
        ]);
        if (!alive) return;
        setA(analytics);
        setPeople(friends);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [tick]);

  // Nothing logged is not an empty three-column grid; it is no block at all.
  if (failed || !a || a.totalVisits === 0) return null;

  const spots = a.topSpots.slice(0, 3);
  const cuisines = a.cuisineBreakdown
    .filter((c) => c.cuisine && c.cuisine !== "other")
    .slice(0, 3);

  return (
    <View style={styles.wrap}>
      <View style={styles.col}>
        <Text style={styles.head}>TOP SPOTS</Text>
        {spots.length === 0 && <Text style={styles.none}>—</Text>}
        {spots.map((s, i) => (
          <View key={s.name} style={styles.cell}>
            <Text style={styles.rank}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={2}>{s.name}</Text>
              <Text style={styles.meta}>×{s.count}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.divider} />

      <View style={styles.col}>
        <Text style={styles.head}>TOP CUISINES</Text>
        {cuisines.length === 0 && <Text style={styles.none}>—</Text>}
        {cuisines.map((c, i) => (
          <View key={c.cuisine} style={styles.cell}>
            <Text style={styles.rank}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={2}>{cuisineLabel(c.cuisine)}</Text>
              <Text style={styles.meta}>{Math.round(c.pct * 100)}%</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.divider} />

      <View style={styles.col}>
        <Text style={styles.head}>PALATE FRIENDS</Text>
        {people.length === 0 && <Text style={styles.none}>Nobody overlaps you yet</Text>}
        {people.map((p) => (
          <Pressable
            key={p.id}
            style={styles.cell}
            onPress={() => router.push(`/profile/${p.id}` as never)}
            accessibilityRole="button"
          >
            <Avatar uri={p.avatar_url} name={p.display_name} size={20} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={2}>
                {p.display_name || (p.username ? `@${p.username}` : "Someone")}
              </Text>
              <Text style={styles.meta}>{Math.round(p.score)}% match</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    marginTop: spacing.lg,
    padding: card.padding,
    borderRadius: card.radius,
    backgroundColor: colors.faint,
    ...shadow.card,
  },
  col: { flex: 1, gap: 10 },
  divider: { width: 1, backgroundColor: colors.line, marginHorizontal: 10 },
  head: { ...type.micro, fontSize: 9, letterSpacing: 0.6 },
  cell: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  rank: { fontSize: 11, fontWeight: "800", color: colors.red, width: 10, marginTop: 1 },
  name: { fontSize: 12, fontWeight: "700", color: colors.ink, lineHeight: 15 },
  meta: { fontSize: 10, fontWeight: "600", color: colors.mute, marginTop: 1 },
  none: { fontSize: 11, fontWeight: "500", color: colors.mute },
});
