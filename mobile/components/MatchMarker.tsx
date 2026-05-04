import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../theme";
import { matchScoreColor } from "../lib/match-score";

// ============================================================================
// MatchMarker — gradient pin + soft glow halo. Color tier follows the same
// 4-step ramp used everywhere else (strong red → lighter red → light gray →
// gray). High-match pins get an extra animated breath so the eye lands on
// them first when scanning the map.
// ============================================================================

const PULSE_THRESHOLD = 50;

export function MatchMarker({ score }: { score: number | null }) {
  if (score == null) {
    return <View style={styles.dot} />;
  }
  const base = matchScoreColor(score);
  const top = lighten(base, 0.18);
  const bottom = darken(base, 0.22);
  // Pulse strength scales with score: 50 → barely visible, 100 → strong.
  // This gives instant visual hierarchy across the map.
  const pulseStrength = score >= PULSE_THRESHOLD
    ? Math.min(1, (score - PULSE_THRESHOLD) / 50)
    : 0;
  return <PinBody score={score} top={top} bottom={bottom} glow={base} pulseStrength={pulseStrength} />;
}

function PinBody({ score, top, bottom, glow, pulseStrength }: {
  score: number; top: string; bottom: string; glow: string;
  /** 0..1 — controls halo size, opacity, and breath duration. */
  pulseStrength: number;
}) {
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (pulseStrength <= 0) return;
    // Faster breath for higher scores so the most compatible spots feel alive.
    const duration = 1500 - pulseStrength * 600; // 1500ms at 50, 900ms at 100
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseStrength, breath]);

  // Bigger halo + higher peak opacity for higher pulseStrength.
  const haloScale = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.25 + 0.35 * pulseStrength], // 1.25 at 50, 1.6 at 100
  });
  const haloOpacity = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25 + 0.4 * pulseStrength, 0],
  });

  return (
    <View style={styles.wrap}>
      {pulseStrength > 0 && (
        <Animated.View
          style={[
            styles.halo,
            { backgroundColor: glow, transform: [{ scale: haloScale }], opacity: haloOpacity },
          ]}
        />
      )}
      <View style={[styles.pinShadow, { shadowColor: glow, shadowOpacity: 0.4 + 0.4 * pulseStrength }]}>
        <View style={styles.pin}>
          <LinearGradient
            colors={[top, bottom]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.gloss} />
          <Text style={styles.pinText}>{score}</Text>
        </View>
      </View>
    </View>
  );
}

// ============================================================================
// TopMatchMarker — the very best nearby spot. Layered halo + glow + morphing
// core, kept distinct from the regular pin so it's instantly the center of
// attention on the map.
// ============================================================================

export function TopMatchMarker({ score }: { score: number }) {
  const halo = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const morph = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const haloLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(halo, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(halo, { toValue: 0, duration: 1600, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const morphLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(morph, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(morph, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    haloLoop.start(); breathLoop.start(); morphLoop.start();
    return () => { haloLoop.stop(); breathLoop.stop(); morphLoop.stop(); };
  }, [halo, breath, morph]);

  const haloScale = halo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] });
  const haloOpacity = halo.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const breathOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.85] });
  const coreScaleY = morph.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
  const coreScaleX = morph.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] });

  return (
    <View style={styles.topWrap}>
      <Animated.View style={[styles.topHalo, { transform: [{ scale: haloScale }], opacity: haloOpacity }]} />
      <Animated.View style={[styles.topGlow, { transform: [{ scale: breathScale }], opacity: breathOpacity }]} />
      <Animated.View
        style={[
          styles.topCore,
          { transform: [{ scaleX: coreScaleX }, { scaleY: coreScaleY }] },
        ]}
      >
        <LinearGradient
          colors={["#FFB68C", "#FF3008", "#7A0B00"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Text style={styles.coreScore}>{score}</Text>
      </Animated.View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// Color helpers — mix toward white/black without bringing in a color lib.
// Accepts #RRGGBB only.
// ----------------------------------------------------------------------------
function lighten(hex: string, amount: number): string {
  return mix(hex, "#FFFFFF", amount);
}
function darken(hex: string, amount: number): string {
  return mix(hex, "#000000", amount);
}
function mix(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  wrap: {
    width: 60, height: 44,
    alignItems: "center", justifyContent: "center",
  },
  dot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.mute,
    borderWidth: 2, borderColor: "#fff",
  },
  halo: {
    position: "absolute",
    width: 56, height: 36, borderRadius: 18,
  },
  pinShadow: {
    shadowOpacity: 0.55,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  pin: {
    minWidth: 44, height: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.95)",
    overflow: "hidden",
  },
  gloss: {
    position: "absolute",
    top: 0, left: 0, right: 0, height: 12,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderTopLeftRadius: 13, borderTopRightRadius: 13,
  },
  pinText: { color: "#fff", fontSize: 12, fontWeight: "800", letterSpacing: 0.2 },

  topWrap: { width: 72, height: 72, alignItems: "center", justifyContent: "center" },
  topHalo: {
    position: "absolute",
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.red,
  },
  topGlow: {
    position: "absolute",
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: "#FF6B45",
  },
  topCore: {
    width: 36, height: 36, borderRadius: 18,
    overflow: "hidden",
    alignItems: "center", justifyContent: "center",
    shadowColor: colors.red,
    shadowOpacity: 0.8,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.95)",
  },
  coreScore: { color: "#fff", fontSize: 12, fontWeight: "800", letterSpacing: 0.2 },
});
