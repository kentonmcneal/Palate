import { View, Text, StyleSheet } from "react-native";
import { colors, spacing } from "../theme";
import type { PalateProfile } from "../lib/palate";

// ============================================================================
// PalateAxisGraph — minimal 2x2 graph showing the user's position.
// ----------------------------------------------------------------------------
//          Premium ↑
//             |
//   Steward   |   Curator
//             |
//   <- Consistency ----- Novelty ->
//             |
//   Anchor    |   Forager
//             |
//          Casual ↓
//
// Position dot is placed at (noveltyScore, premiumScore) in a 0..1 grid,
// with a glowing halo for visibility.
// ============================================================================

const SIZE = 240;
const DOT = 14;
const PAD = 14;
const PLOT = SIZE - PAD * 2;

export function PalateAxisGraph({ profile }: { profile: PalateProfile }) {
  // Map (0..1, 0..1) → pixel positions inside the plot area.
  // Premium axis is inverted — high premium is at TOP, so y = 1 - score.
  const cx = PAD + profile.position.x * PLOT;
  const cy = PAD + (1 - profile.position.y) * PLOT;

  return (
    <View style={styles.wrap}>
      <View style={styles.plot}>
        {/* Quadrant background tints — subtle */}
        <View style={[styles.quadrant, styles.qTopLeft]} />
        <View style={[styles.quadrant, styles.qTopRight]} />
        <View style={[styles.quadrant, styles.qBotLeft]} />
        <View style={[styles.quadrant, styles.qBotRight]} />

        {/* Cross-hair */}
        <View style={[styles.axisLine, styles.axisVertical]} />
        <View style={[styles.axisLine, styles.axisHorizontal]} />

        {/* Quadrant labels */}
        <Text style={[styles.qLabel, styles.qLabelTopLeft]}>Steward</Text>
        <Text style={[styles.qLabel, styles.qLabelTopRight]}>Curator</Text>
        <Text style={[styles.qLabel, styles.qLabelBotLeft]}>Anchor</Text>
        <Text style={[styles.qLabel, styles.qLabelBotRight]}>Forager</Text>

        {/* Position dot — glowing halo + solid core. Hidden in Learning state */}
        {profile.primaryIdentity !== "Learning" && (
          <>
            <View
              style={[
                styles.dotHalo,
                { left: cx - 22, top: cy - 22 },
              ]}
            />
            <View
              style={[
                styles.dot,
                { left: cx - DOT / 2, top: cy - DOT / 2 },
              ]}
            />
          </>
        )}
      </View>

      {/* Axis labels outside the plot */}
      <View style={styles.axisLabelsOuter}>
        <Text style={[styles.axisCaption, { top: -2, alignSelf: "center" }]}>↑ Premium</Text>
      </View>
      <View style={[styles.axisLabelsOuter, { bottom: 0 }]}>
        <Text style={[styles.axisCaption, { alignSelf: "center" }]}>Casual ↓</Text>
      </View>
      <Text style={[styles.axisCaption, { position: "absolute", left: 4, top: SIZE / 2 - 8 }]}>← Consistency</Text>
      <Text style={[styles.axisCaption, { position: "absolute", right: 4, top: SIZE / 2 - 8 }]}>Novelty →</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
    alignSelf: "center",
    position: "relative",
    marginVertical: spacing.lg,
  },
  plot: {
    position: "absolute",
    left: 0, top: 0,
    width: SIZE, height: SIZE,
  },
  quadrant: {
    position: "absolute",
    width: SIZE / 2, height: SIZE / 2,
    backgroundColor: colors.faint,
  },
  qTopLeft:  { left: 0,        top: 0,         borderTopLeftRadius: 16 },
  qTopRight: { left: SIZE / 2, top: 0,         borderTopRightRadius: 16 },
  qBotLeft:  { left: 0,        top: SIZE / 2,  borderBottomLeftRadius: 16 },
  qBotRight: { left: SIZE / 2, top: SIZE / 2,  borderBottomRightRadius: 16 },
  axisLine: {
    position: "absolute",
    backgroundColor: colors.line,
  },
  axisVertical:   { left: SIZE / 2 - 0.5, top: 0,           width: 1, height: SIZE },
  axisHorizontal: { left: 0,              top: SIZE / 2 - 0.5, width: SIZE, height: 1 },
  qLabel: {
    position: "absolute",
    fontSize: 11,
    fontWeight: "700",
    color: colors.mute,
    letterSpacing: 0.4,
  },
  qLabelTopLeft:  { left: 12, top: 12 },
  qLabelTopRight: { right: 12, top: 12 },
  qLabelBotLeft:  { left: 12, bottom: 12 },
  qLabelBotRight: { right: 12, bottom: 12 },

  dot: {
    position: "absolute",
    width: DOT, height: DOT, borderRadius: DOT / 2,
    backgroundColor: colors.red,
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: colors.red,
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  dotHalo: {
    position: "absolute",
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.red,
    opacity: 0.18,
  },

  axisLabelsOuter: {
    position: "absolute",
    left: 0, right: 0,
  },
  axisCaption: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.mute,
    letterSpacing: 0.6,
  },
});
