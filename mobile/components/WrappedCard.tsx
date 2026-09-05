import { View, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius } from "../theme";
import type { Wrapped } from "../lib/wrapped";
import { CanvasText } from "./CanvasText";

import type { WrappedStats } from "../lib/wrapped-scope";

export function WrappedCard({
  data,
  personaOverride,
  personaDescription,
  topCuisines,
  stats,
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
  /** When given, the card shows these numbers instead of the stored week's.
   *  Used to lead with all-time while the week keeps its own section below. */
  stats?: WrappedStats;
}) {
  const j = data.wrapped_json;
  const personaLabel = personaOverride || data.personality_label;

  const top3 = stats ? stats.topThree : (j.top_three ?? []);
  const totalVisits = stats ? stats.totalVisits : data.total_visits;
  const uniquePlaces = stats ? stats.uniqueRestaurants : data.unique_restaurants;
  const repeatPct = Math.round(
    (stats ? stats.repeatRate : (data.repeat_rate ?? 0)) * 100,
  );
  const rangeLabel = stats ? stats.rangeLabel : formatRange(data.week_start, data.week_end);
  const eyebrow = stats ? stats.eyebrow : "YOUR PALATE THIS WEEK";

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
          <CanvasText style={styles.logoP}>p</CanvasText>
        </View>
        <CanvasText style={styles.weekText}>{rangeLabel}</CanvasText>
      </View>

      <CanvasText style={styles.youAre}>{eyebrow}</CanvasText>
      <CanvasText style={styles.persona}>{personaLabel}</CanvasText>
      {personaDescription ? (
        <CanvasText style={styles.personaDescription}>{personaDescription}</CanvasText>
      ) : null}

      <View style={styles.stats}>
        <Stat label="visits" value={String(totalVisits)} />
        <Stat label="places" value={String(uniquePlaces)} />
        <Stat label="repeat" value={`${repeatPct}%`} />
      </View>

      <CanvasText style={styles.topLabel}>Top spots</CanvasText>
      <View style={{ marginTop: 8 }}>
        {top3.map((row, i) => (
          <View key={`${row.name}-${i}`} style={styles.topRow}>
            <CanvasText style={styles.topName}>
              <CanvasText style={styles.topRank}>{i + 1}  </CanvasText>
              {row.name}
            </CanvasText>
            <CanvasText style={styles.topCount}>×{row.count}</CanvasText>
          </View>
        ))}
      </View>

      {topCuisines && topCuisines.length > 0 && (
        <>
          <CanvasText style={[styles.topLabel, { marginTop: 18 }]}>Top cuisines</CanvasText>
          <View style={styles.cuisineRow}>
            {topCuisines.slice(0, 3).map((c) => (
              <View key={c.name} style={styles.cuisineChip}>
                <CanvasText style={styles.cuisineChipText}>{c.name}</CanvasText>
                <CanvasText style={styles.cuisineChipPct}>{Math.round(c.share * 100)}%</CanvasText>
              </View>
            ))}
          </View>
        </>
      )}

      <CanvasText style={styles.brand}>palate.app</CanvasText>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <CanvasText style={styles.statValue}>{value}</CanvasText>
      <CanvasText style={styles.statLabel}>{label}</CanvasText>
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

// This card is the one deliberately DARK surface in the app — it is the share
// artifact, and a dark Wrapped card is the convention people recognise. That
// makes the shared tokens wrong here: colors.ink is #222222, which is correct
// on the app's light ground and invisible on this gradient. These are the
// on-dark equivalents, and the reason they are literals rather than theme
// tokens is that nothing else in the app draws on black.
const ON_DARK = {
  primary: "#FFFFFF",
  secondary: "rgba(255,255,255,0.72)",
  label: "rgba(255,255,255,0.55)",
  faintLabel: "rgba(255,255,255,0.42)",
  hairline: "rgba(255,255,255,0.14)",
} as const;

const styles = StyleSheet.create({
  card: {
    borderRadius: 28,
    padding: 24,
    overflow: "hidden",
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  glowRed: {
    position: "absolute",
    top: -100,
    right: -80,
    width: 280,
    height: 280,
    borderRadius: 999,
    backgroundColor: colors.red,
    opacity: 0.05,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logoBox: {
    width: 32,
    minHeight: 32, paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  logoP: { color: "#FFF", fontWeight: "800", fontSize: 18 },
  weekText: { color: ON_DARK.secondary, fontSize: 13 },
  youAre: {
    color: ON_DARK.label,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 24,
  },
  persona: {
    color: colors.red,
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -0.7,
    lineHeight: 40,
    marginTop: 4,
  },
  personaDescription: {
    color: ON_DARK.secondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    fontWeight: "500",
  },
  stats: { flexDirection: "row", gap: 10, marginTop: 24 },
  stat: {
    flex: 1,
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  statValue: { color: colors.ink, fontSize: 26, fontWeight: "800" },
  statLabel: {
    color: colors.mute,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 4,
  },
  topLabel: {
    color: ON_DARK.label,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 24,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomColor: ON_DARK.hairline,
    borderBottomWidth: 1,
  },
  topName: { color: ON_DARK.primary, fontSize: 15 },
  topRank: { color: ON_DARK.label },
  topCount: { color: ON_DARK.secondary },
  brand: { color: ON_DARK.faintLabel, marginTop: 24, fontSize: 12 },

  cuisineRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  cuisineChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.redTint,
    borderWidth: 1, borderColor: colors.redTintBorder,
  },
  cuisineChipText: { color: colors.redText, fontSize: 12, fontWeight: "700" },
  cuisineChipPct: { color: colors.mute, fontSize: 11, fontWeight: "700" },
});
