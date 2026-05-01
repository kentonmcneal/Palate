import { View, Text, StyleSheet, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../theme";
import type { Wrapped } from "../lib/wrapped";

// Instagram story aspect ratio: 9:16. Width = ~1080 ideal but we render at
// device width and let view-shot capture pixel-perfect.
const STORY_W = Dimensions.get("window").width - 32;
const STORY_H = STORY_W * (16 / 9);

export function WrappedStoryCard({
  data,
  personaOverride,
}: {
  data: Wrapped;
  personaOverride?: string;
}) {
  const j = data.wrapped_json;
  const top3 = j.top_three ?? [];
  const personaLabel = personaOverride || data.personality_label;

  return (
    <View style={[styles.card, { width: STORY_W, height: STORY_H }]} collapsable={false}>
      <LinearGradient
        colors={["#1A1A1A", "#0E0E0E"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />
      <View style={styles.glowRed} />

      {/* Top: brand + week */}
      <View style={styles.head}>
        <View style={styles.logoBox}><Text style={styles.logoP}>p</Text></View>
        <Text style={styles.brandText}>palate</Text>
      </View>

      <Text style={styles.weekRange}>{formatRange(data.week_start, data.week_end)}</Text>

      {/* Center: persona */}
      <View style={styles.center}>
        <Text style={styles.youAre}>YOU ARE</Text>
        <Text style={styles.persona} numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.7}>
          {personaLabel}
        </Text>
      </View>

      {/* Stats row */}
      <View style={styles.stats}>
        <Stat label="visits" value={String(data.total_visits)} />
        <Stat label="places" value={String(data.unique_restaurants)} />
        <Stat label="repeat" value={`${Math.round((data.repeat_rate ?? 0) * 100)}%`} />
      </View>

      {/* Top spots */}
      {top3.length > 0 && (
        <View style={styles.top}>
          <Text style={styles.topLabel}>TOP SPOTS</Text>
          {top3.slice(0, 3).map((row, i) => (
            <View key={`${row.name}-${i}`} style={styles.topRow}>
              <Text style={styles.topName}>
                <Text style={styles.topRank}>{i + 1}.  </Text>
                {row.name}
              </Text>
              <Text style={styles.topCount}>×{row.count}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Bottom: handle */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>palate.app</Text>
      </View>
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
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(s)} — ${fmt(e)}`;
}

const styles = StyleSheet.create({
  card: { borderRadius: 28, overflow: "hidden", padding: 32, justifyContent: "space-between" },
  glowRed: {
    position: "absolute",
    top: -100, right: -80,
    width: 280, height: 280, borderRadius: 999,
    backgroundColor: colors.red, opacity: 0.35,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoBox: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: colors.red, alignItems: "center", justifyContent: "center",
  },
  logoP: { color: "#fff", fontWeight: "800", fontSize: 20 },
  brandText: { color: "#fff", fontSize: 22, fontWeight: "700", letterSpacing: -0.6 },
  weekRange: { color: "rgba(255,255,255,0.65)", fontSize: 14, marginTop: 6 },

  center: { marginTop: 20 },
  youAre: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "700", letterSpacing: 2 },
  persona: {
    color: colors.red,
    fontSize: 56,
    fontWeight: "800",
    letterSpacing: -1.2,
    lineHeight: 60,
    marginTop: 8,
  },

  stats: { flexDirection: "row", gap: 10, marginTop: 24 },
  stat: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.12)", borderWidth: 1,
    borderRadius: 16, padding: 14,
  },
  statValue: { color: "#fff", fontSize: 24, fontWeight: "800" },
  statLabel: {
    color: "rgba(255,255,255,0.6)", fontSize: 10, fontWeight: "600",
    letterSpacing: 1.4, textTransform: "uppercase", marginTop: 4,
  },

  top: { marginTop: 28 },
  topLabel: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  topRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomColor: "rgba(255,255,255,0.1)", borderBottomWidth: 1,
  },
  topName: { color: "#fff", fontSize: 17, fontWeight: "600" },
  topRank: { color: "rgba(255,255,255,0.5)" },
  topCount: { color: "rgba(255,255,255,0.65)", fontSize: 16, fontWeight: "700" },

  footer: { alignItems: "center" },
  footerText: { color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: "600" },
});
