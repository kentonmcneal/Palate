import { View, Text, StyleSheet, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { palateColors, palateGradients } from "../lib/theme/palateTheme";
import type { PalateProfile, PrimaryIdentity } from "../lib/palate";
import { IDENTITY_BLURB } from "../lib/palate";

// ============================================================================
// SharePalateCard — 9:16 vertical share card. Spotify-Wrapped energy.
// ----------------------------------------------------------------------------
// Per design bible:
//   • 9:16 aspect ratio (1080x1920 ideal export)
//   • Black or deep wine background (uses palateGradients.shareWine)
//   • Palate logo + "Your Palate This Week" eyebrow
//   • Identity hero (display-grade font)
//   • Short descriptor (from IDENTITY_BLURB.shareDescriptor)
//   • 2-3 stats max
//   • 3 tags max
//   • Optional ego hook
//   • palate.app footer
//
// Captured via react-native-view-shot from the parent (typically Wrapped).
// ============================================================================

// Render at device width / aspect ratio for live preview. View-shot will
// upscale on capture.
const SHARE_W = Dimensions.get("window").width - 48;
const SHARE_H = SHARE_W * (16 / 9);

export type ShareStat = { label: string; value: string };

type Props = {
  identity: PrimaryIdentity;
  /** Date range like "May 6 — May 12" */
  weekRange: string;
  /** Up to 3 stats — visits, places, repeat etc. */
  stats: ShareStat[];
  /** Up to 3 tags. */
  tags: string[];
  /** Optional ego hook line ("Top 7% in exploration"). */
  egoHook?: string;
};

export function SharePalateCard({ identity, weekRange, stats, tags, egoHook }: Props) {
  const blurb = IDENTITY_BLURB[identity];
  const safeTags = (tags ?? []).filter(Boolean).slice(0, 3);
  const safeStats = (stats ?? []).slice(0, 3);

  return (
    <View style={styles.card} collapsable={false}>
      <LinearGradient
        colors={palateGradients.shareWine}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Soft red glow accent — top-right corner */}
      <View style={styles.glow} />

      {/* Header — logo + eyebrow */}
      <View style={styles.header}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoP}>p</Text>
        </View>
        <Text style={styles.brandText}>palate</Text>
      </View>
      <Text style={styles.eyebrow}>YOUR PALATE THIS WEEK</Text>
      <Text style={styles.weekRange}>{weekRange}</Text>

      {/* Hero identity */}
      <View style={styles.heroBlock}>
        <Text
          style={styles.identity}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {identity}
        </Text>
        <Text style={styles.descriptor}>{blurb.shareDescriptor}</Text>
      </View>

      {/* Stats row */}
      {safeStats.length > 0 && (
        <View style={styles.stats}>
          {safeStats.map((s) => (
            <View key={s.label} style={styles.statBlock}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Tags row */}
      {safeTags.length > 0 && (
        <Text style={styles.tagsLine}>{safeTags.join(" · ")}</Text>
      )}

      {/* Optional ego hook */}
      {egoHook && (
        <View style={styles.egoChip}>
          <Text style={styles.egoChipText}>{egoHook}</Text>
        </View>
      )}

      {/* Footer */}
      <Text style={styles.footer}>palate.app</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: SHARE_W,
    height: SHARE_H,
    borderRadius: 28,
    overflow: "hidden",
    padding: 28,
  },
  glow: {
    position: "absolute",
    top: -80, right: -80,
    width: 320, height: 320, borderRadius: 999,
    backgroundColor: palateColors.red,
    opacity: 0.45,
  },

  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoBadge: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: palateColors.red,
    alignItems: "center", justifyContent: "center",
  },
  logoP: { color: "#fff", fontWeight: "800", fontSize: 18 },
  brandText: { color: "#fff", fontSize: 18, fontWeight: "800", letterSpacing: -0.4 },

  eyebrow: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11, fontWeight: "700", letterSpacing: 1.8,
    marginTop: 28,
  },
  weekRange: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13, fontWeight: "600",
    marginTop: 4,
  },

  heroBlock: { marginTop: 24 },
  identity: {
    color: palateColors.red,
    fontSize: 72,
    fontWeight: "800",
    letterSpacing: -2,
    lineHeight: 76,
    // Brand-colored text glow — identity reads as lit from inside, not flat.
    textShadowColor: "rgba(255,45,22,0.7)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 24,
  },
  descriptor: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 17,
    fontWeight: "500",
    lineHeight: 24,
    marginTop: 12,
  },

  stats: {
    flexDirection: "row",
    gap: 10,
    marginTop: "auto",
    paddingTop: 28,
  },
  statBlock: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  statValue: { color: "#fff", fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  statLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 10, fontWeight: "700",
    letterSpacing: 1.4, textTransform: "uppercase",
    marginTop: 4,
  },

  tagsLine: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13, fontWeight: "700",
    letterSpacing: 0.4,
    marginTop: 16,
  },

  egoChip: {
    alignSelf: "flex-start",
    marginTop: 14,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,45,22,0.15)",
    borderWidth: 1, borderColor: "rgba(255,45,22,0.4)",
  },
  egoChipText: {
    color: "#fff",
    fontSize: 11, fontWeight: "800",
    letterSpacing: 1.2, textTransform: "uppercase",
  },

  footer: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12, fontWeight: "600",
    letterSpacing: 0.4,
    marginTop: 18,
    alignSelf: "center",
  },
});
