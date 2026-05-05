import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius } from "../theme";
import type { Wrapped } from "../lib/wrapped";

export function WrappedCard({
  data,
  personaOverride,
  personaDescription,
  topCuisines,
}: {
  data: Wrapped;
  /** When provided, replaces the stored personality_label — used to render
   * the Palate Feature Engine's composed identity. */
  personaOverride?: string;
  /** One-line description of what the persona means. Surfaces below the
   *  identity label as a calm, premium subtitle. */
  personaDescription?: string;
  /** Optional top 3 cuisines (already mapped to display labels). Shown as a
   *  chip row inside the black hero — same data as Profile, surfaced here
   *  so Wrapped tells the full story without an extra tab hop. */
  topCuisines?: { name: string; share: number }[];
}) {
  const j = data.wrapped_json;
  const top3 = j.top_three ?? [];
  const personaLabel = personaOverride || data.personality_label;

  return (
    <View style={styles.card} collapsable={false}>
      <LinearGradient
        colors={["#1A1A1A", "#0E0E0E"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <View style={styles.glowRed} />

      <View style={styles.row}>
        <View style={styles.logoBox}>
          <Text style={styles.logoP}>p</Text>
        </View>
        <Text style={styles.weekText}>
          {formatRange(data.week_start, data.week_end)}
        </Text>
      </View>

      <Text style={styles.youAre}>YOUR PALATE THIS WEEK</Text>
      <Text style={styles.persona}>{personaLabel}</Text>
      {personaDescription ? (
        <Text style={styles.personaDescription}>{personaDescription}</Text>
      ) : null}

      <View style={styles.stats}>
        <Stat label="visits" value={String(data.total_visits)} />
        <Stat label="places" value={String(data.unique_restaurants)} />
        <Stat
          label="repeat"
          value={`${Math.round((data.repeat_rate ?? 0) * 100)}%`}
        />
      </View>

      <Text style={styles.topLabel}>Top spots</Text>
      <View style={{ marginTop: 8 }}>
        {top3.map((row, i) => (
          <View key={`${row.name}-${i}`} style={styles.topRow}>
            <Text style={styles.topName}>
              <Text style={styles.topRank}>{i + 1}  </Text>
              {row.name}
            </Text>
            <Text style={styles.topCount}>×{row.count}</Text>
          </View>
        ))}
      </View>

      {topCuisines && topCuisines.length > 0 && (
        <>
          <Text style={[styles.topLabel, { marginTop: 18 }]}>Top cuisines</Text>
          <View style={styles.cuisineRow}>
            {topCuisines.slice(0, 3).map((c) => (
              <View key={c.name} style={styles.cuisineChip}>
                <Text style={styles.cuisineChipText}>{c.name}</Text>
                <Text style={styles.cuisineChipPct}>{Math.round(c.share * 100)}%</Text>
              </View>
            ))}
          </View>
        </>
      )}

      <Text style={styles.brand}>palate.app</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatRange(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(s)} — ${fmt(e)}`;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 28,
    padding: 24,
    overflow: "hidden",
    backgroundColor: colors.ink,
  },
  glowRed: {
    position: "absolute",
    top: -80,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: colors.red,
    opacity: 0.3,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logoBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  logoP: { color: "#FFF", fontWeight: "800", fontSize: 18 },
  weekText: { color: "rgba(255,255,255,0.7)", fontSize: 13 },
  youAre: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 24,
  },
  persona: {
    color: colors.red,
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -0.6,
    marginTop: 4,
  },
  personaDescription: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    fontWeight: "500",
  },
  stats: { flexDirection: "row", gap: 10, marginTop: 24 },
  stat: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  statValue: { color: "#FFF", fontSize: 26, fontWeight: "800" },
  statLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 4,
  },
  topLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 24,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomColor: "rgba(255,255,255,0.1)",
    borderBottomWidth: 1,
  },
  topName: { color: "#FFF", fontSize: 15 },
  topRank: { color: "rgba(255,255,255,0.5)" },
  topCount: { color: "rgba(255,255,255,0.6)" },
  brand: { color: "rgba(255,255,255,0.5)", marginTop: 24, fontSize: 12 },

  cuisineRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  cuisineChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.16)",
  },
  cuisineChipText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  cuisineChipPct: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700" },
});
