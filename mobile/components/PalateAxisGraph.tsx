import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import Svg, { Defs, Marker, Path } from "react-native-svg";
import { colors, spacing } from "../theme";
import { palateColors, palateMotion } from "../lib/theme/palateTheme";
import type { PalateProfile } from "../lib/palate";

// ============================================================================
// PalateAxisGraph — premium 2x2 axis graph.
// ----------------------------------------------------------------------------
//                       Premium
//                          ↑
//                  +-----------------+
//      Consistency | Steward | Curator | Novelty
//             ←    +---------+---------+    →
//                  | Anchor  | Forager |
//                  +---------+---------+
//                          ↓
//                        Casual
//
// Axis labels live OUTSIDE the square. Inside the square: only quadrant names.
// User dot pulses slowly. If a prior-week position is known, a small arrow
// connects it to the current dot to show movement.
// ============================================================================

const SIZE = 220;
const DOT = 22;
const PAD = 0;
const PLOT = SIZE - PAD * 2;

// Outer label gutter. The square gets centered inside an enlarged container so
// labels can sit comfortably outside.
const LABEL_PAD_V = 22;
const LABEL_PAD_H = 78;

export function PalateAxisGraph({ profile }: { profile: PalateProfile }) {
  // Map (0..1, 0..1) → pixel positions inside the plot area.
  // Premium axis is inverted — high premium is at TOP, so y = 1 - score.
  const cx = PAD + profile.position.x * PLOT;
  const cy = PAD + (1 - profile.position.y) * PLOT;

  const prior = profile.priorPosition;
  const showArrow =
    prior &&
    profile.primaryIdentity !== "Learning" &&
    // Only show movement if it's perceptible (>4% on either axis).
    (Math.abs(prior.x - profile.position.x) > 0.04 ||
      Math.abs(prior.y - profile.position.y) > 0.04);

  const px = prior ? PAD + prior.x * PLOT : 0;
  const py = prior ? PAD + (1 - prior.y) * PLOT : 0;

  // Pulse animation — slow heartbeat on the user dot.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (profile.primaryIdentity === "Learning") return;
    const half = palateMotion?.pulseHalf ?? 1250;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1, duration: half,
          easing: Easing.inOut(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0, duration: half,
          easing: Easing.inOut(Easing.quad), useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, profile.primaryIdentity]);

  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.18] });

  const userQuadrant = profile.primaryIdentity;
  const isActive = (q: typeof userQuadrant) => q === userQuadrant;

  return (
    <View style={styles.wrap}>
      {/* Top axis label (outside square) */}
      <Text style={[styles.axisLabel, styles.axisTop]}>Premium</Text>

      {/* Left axis label (outside, vertically centered) */}
      <Text style={[styles.axisLabel, styles.axisLeft]}>Consistency</Text>

      {/* Right axis label (outside, vertically centered) */}
      <Text style={[styles.axisLabel, styles.axisRight]}>Novelty</Text>

      {/* Bottom axis label (outside square) */}
      <Text style={[styles.axisLabel, styles.axisBottom]}>Casual</Text>

      <View style={styles.plot}>
        {/* Quadrant background — only the user's quadrant is tinted red. */}
        <View style={[styles.quadrant, styles.qTopLeft,  isActive("Steward") && styles.qActive]} />
        <View style={[styles.quadrant, styles.qTopRight, isActive("Curator") && styles.qActive]} />
        <View style={[styles.quadrant, styles.qBotLeft,  isActive("Anchor")  && styles.qActive]} />
        <View style={[styles.quadrant, styles.qBotRight, isActive("Forager") && styles.qActive]} />

        {/* Cross-hair — softened to ~14% opacity so the quadrants do most of the talking */}
        <View style={[styles.axisLine, styles.axisVertical]} />
        <View style={[styles.axisLine, styles.axisHorizontal]} />

        {/* Quadrant labels — current is red, others muted gray. */}
        <Text style={[styles.qLabel, styles.qLabelTopLeft,  isActive("Steward") && styles.qLabelActive]}>Steward</Text>
        <Text style={[styles.qLabel, styles.qLabelTopRight, isActive("Curator") && styles.qLabelActive]}>Curator</Text>
        <Text style={[styles.qLabel, styles.qLabelBotLeft,  isActive("Anchor")  && styles.qLabelActive]}>Anchor</Text>
        <Text style={[styles.qLabel, styles.qLabelBotRight, isActive("Forager") && styles.qLabelActive]}>Forager</Text>

        {/* Movement arrow (prior week → now). Drawn on top of the quadrants
            but UNDER the user dot so the dot reads as the destination. */}
        {showArrow && (
          <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
            <Defs>
              <Marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <Path d="M 0 0 L 10 5 L 0 10 z" fill={palateColors.red} />
              </Marker>
            </Defs>
            <Path
              d={`M ${px} ${py} L ${cx} ${cy}`}
              stroke={palateColors.red}
              strokeOpacity={0.6}
              strokeWidth={1.8}
              strokeDasharray="3,3"
              fill="none"
              markerEnd="url(#arrow)"
            />
          </Svg>
        )}

        {/* Position dot — slightly larger, white outline, soft red halo + pulse.
            Hidden in Learning state. */}
        {profile.primaryIdentity !== "Learning" && (
          <>
            <Animated.View
              style={[
                styles.dotHalo,
                {
                  left: cx - 28,
                  top: cy - 28,
                  transform: [{ scale: haloScale }],
                  opacity: haloOpacity,
                },
              ]}
            />
            <View
              style={[
                styles.dot,
                { left: cx - DOT / 2, top: cy - DOT / 2 },
              ]}
            />
            <View
              style={[
                styles.dotInner,
                { left: cx - 4, top: cy - 4 },
              ]}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE + LABEL_PAD_H * 2,
    height: SIZE + LABEL_PAD_V * 2,
    alignSelf: "center",
    position: "relative",
    marginVertical: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  plot: {
    width: SIZE,
    height: SIZE,
    position: "relative",
  },
  quadrant: {
    position: "absolute",
    width: SIZE / 2, height: SIZE / 2,
    backgroundColor: "rgba(231,227,224,0.35)",
  },
  qActive: {
    backgroundColor: "rgba(255,45,22,0.12)",
  },
  qTopLeft:  { left: 0,        top: 0,         borderTopLeftRadius: 18 },
  qTopRight: { left: SIZE / 2, top: 0,         borderTopRightRadius: 18 },
  qBotLeft:  { left: 0,        top: SIZE / 2,  borderBottomLeftRadius: 18 },
  qBotRight: { left: SIZE / 2, top: SIZE / 2,  borderBottomRightRadius: 18 },
  axisLine: {
    position: "absolute",
    backgroundColor: "rgba(13,13,13,0.14)",
  },
  axisVertical:   { left: SIZE / 2 - 0.5, top: 0,           width: 1, height: SIZE },
  axisHorizontal: { left: 0,              top: SIZE / 2 - 0.5, width: SIZE, height: 1 },
  qLabel: {
    position: "absolute",
    fontSize: 12,
    fontWeight: "700",
    color: colors.mute,
    letterSpacing: 0.4,
  },
  qLabelActive: {
    color: palateColors.red,
    fontWeight: "800",
  },
  qLabelTopLeft:  { left: 12, top: 12 },
  qLabelTopRight: { right: 12, top: 12 },
  qLabelBotLeft:  { left: 12, bottom: 12 },
  qLabelBotRight: { right: 12, bottom: 12 },

  // Outer axis labels — sit OUTSIDE the square per design bible.
  axisLabel: {
    position: "absolute",
    fontSize: 11,
    fontWeight: "800",
    color: colors.ink,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  axisTop:    { top: 0, alignSelf: "center" },
  axisBottom: { bottom: 0, alignSelf: "center" },
  axisLeft:   {
    left: 4,
    top: "50%",
    transform: [{ translateY: -7 }],
    width: LABEL_PAD_H - 8,
    textAlign: "right",
  },
  axisRight:  {
    right: 4,
    top: "50%",
    transform: [{ translateY: -7 }],
    width: LABEL_PAD_H - 8,
    textAlign: "left",
  },

  dot: {
    position: "absolute",
    width: DOT, height: DOT, borderRadius: DOT / 2,
    backgroundColor: palateColors.red,
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: palateColors.red,
    shadowOpacity: 0.9,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  // Subtle white core so the dot reads "ringed" — gives it more presence.
  dotInner: {
    position: "absolute",
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: "#fff",
  },
  dotHalo: {
    position: "absolute",
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: palateColors.red,
    opacity: 0.25,
  },
});
