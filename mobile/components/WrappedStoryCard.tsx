import { View, StyleSheet, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../theme";
import type { Wrapped } from "../lib/wrapped";
import { CanvasText } from "./CanvasText";
import { cuisineHue } from "./PlaceArt";
import { SHARE_DOMAIN } from "../lib/share-target";

// Instagram story aspect ratio: 9:16. Width = ~1080 ideal but we render at
// device width and let view-shot capture pixel-perfect.
const STORY_W = Dimensions.get("window").width - 32;
const STORY_H = STORY_W * (16 / 9);

export function WrappedStoryCard({
  data,
  personaOverride,
  personaDescription,
}: {
  data: Wrapped;
  personaOverride?: string;
  /** What the identity means, in one line. This card is the one most likely
   *  to be read by somebody who has never opened the app, so the name never
   *  goes out without it. */
  personaDescription?: string;
}) {
  const j = data.wrapped_json;
  const top3 = j.top_three ?? [];
  const personaLabel = personaOverride || data.personality_label;

  // The card takes its colour from what the person actually ate. Every share
  // was the same charcoal-and-red rectangle before this, so a Thai week and a
  // barbecue week were indistinguishable — and a thing worth posting has to
  // look like it belongs to the person posting it. Same cuisineHue the cards
  // in the app use, so somebody's Wrapped matches the colours they have been
  // looking at all week.
  const hue = cuisineHue(j.top_category ?? data.top_category, data.id);
  const deep = shade(hue, 0.72);
  const ink = shade(hue, 0.88);

  return (
    <View style={[styles.card, { width: STORY_W, height: STORY_H }]} collapsable={false}>
      <LinearGradient
        colors={[deep, ink]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
      />
      {/* Two soft lights rather than one, offset, so the card has a direction
          to it instead of a corner smudge. */}
      <View style={[styles.glow, styles.glowTop, { backgroundColor: hue }]} />
      <View style={[styles.glow, styles.glowBottom, { backgroundColor: hue }]} />

      {/* Top: brand + week */}
      <View style={styles.head}>
        <View style={[styles.logoBox, { backgroundColor: hue }]}><CanvasText style={styles.logoP}>p</CanvasText></View>
        <CanvasText style={styles.brandText}>palate</CanvasText>
      </View>

      <CanvasText style={styles.weekRange}>{formatRange(data.week_start, data.week_end)}</CanvasText>

      {/* Center: persona */}
      <View style={styles.center}>
        <CanvasText style={styles.youAre}>YOU ARE</CanvasText>
        <CanvasText style={[styles.persona, { color: "#fff" }]} numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.7}>
          {personaLabel}
        </CanvasText>
        {personaDescription ? (
          <CanvasText style={styles.personaDescription}>{personaDescription}</CanvasText>
        ) : null}
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
          <CanvasText style={styles.topLabel}>TOP SPOTS</CanvasText>
          {top3.slice(0, 3).map((row, i) => (
            <View key={`${row.name}-${i}`} style={styles.topRow}>
              <CanvasText style={styles.topName}>
                <CanvasText style={styles.topRank}>{i + 1}.  </CanvasText>
                {row.name}
              </CanvasText>
              <CanvasText style={styles.topCount}>×{row.count}</CanvasText>
            </View>
          ))}
        </View>
      )}

      {/* Bottom: handle */}
      <View style={styles.footer}>
        <CanvasText style={styles.footerText}>{SHARE_DOMAIN}</CanvasText>
      </View>
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
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(s)} to ${fmt(e)}`;
}

/** Darken toward black, so the gradient's far end is obviously the same hue
 *  rather than a second colour. Mirrors PlaceArt's own shade(). */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const styles = StyleSheet.create({
  card: { borderRadius: 28, overflow: "hidden", padding: 32, justifyContent: "space-between" },
  glow: { position: "absolute", borderRadius: 999 },
  glowTop: { top: -110, right: -90, width: 300, height: 300, opacity: 0.38 },
  glowBottom: { bottom: -140, left: -110, width: 340, height: 340, opacity: 0.22 },
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
    fontSize: 56,
    fontWeight: "800",
    letterSpacing: -1.2,
    lineHeight: 60,
    marginTop: 8,
  },
  personaDescription: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 16,
    lineHeight: 22,
    marginTop: 10,
    fontWeight: "500",
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
  // No hairlines. The founder's rule for every card in the app, and a
  // ruled list is the thing that makes a share look like a spreadsheet.
  topRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 9,
  },
  topName: { color: "#fff", fontSize: 17, fontWeight: "600" },
  topRank: { color: "rgba(255,255,255,0.5)" },
  topCount: { color: "rgba(255,255,255,0.65)", fontSize: 16, fontWeight: "700" },

  footer: { alignItems: "center" },
  footerText: { color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: "600" },
});
