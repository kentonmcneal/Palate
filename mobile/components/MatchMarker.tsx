import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../theme";
import { matchScoreColor } from "../lib/match-score";

// ============================================================================
// MatchMarker — circular pin that morphs into a fireball as compat → 100.
// ----------------------------------------------------------------------------
// Visual progression:
//   < 40   → small gray circle, no animation
//   40-59  → medium gray circle, faint pulse
//   60-79  → red-gradient circle with glow halo, gentle breath
//   80-99  → fireball-class: layered halo + breath + warm gradient core,
//            faster pulse so the eye lands on it first
//   100/top→ TopMatchMarker — full flame morph + double halo
//
// All variants are CIRCULAR (equal width and height) per spec — the old
// oval pill design is gone.
// ============================================================================

const PULSE_THRESHOLD = 40;
const FIREBALL_THRESHOLD = 80;

export function MatchMarker({ score }: { score: number | null }) {
  if (score == null) {
    return <View style={styles.dot} />;
  }
  const base = matchScoreColor(score);
  const top = lighten(base, 0.22);
  const bottom = darken(base, 0.28);
  // Pulse strength scales with score: 40 → barely visible, 100 → strong.
  const pulseStrength = score >= PULSE_THRESHOLD
    ? Math.min(1, (score - PULSE_THRESHOLD) / 60)
    : 0;
  const isFireball = score >= FIREBALL_THRESHOLD;
  return (
    <PinBody
      score={score}
      top={top}
      bottom={bottom}
      glow={base}
      pulseStrength={pulseStrength}
      fireball={isFireball}
    />
  );
}

function PinBody({ score, top, bottom, glow, pulseStrength, fireball }: {
  score: number; top: string; bottom: string; glow: string;
  pulseStrength: number; fireball: boolean;
}) {
  const breath = useRef(new Animated.Value(0)).current;
  const morph = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (pulseStrength <= 0) return;
    const duration = 1500 - pulseStrength * 700; // 1500ms low, 800ms high
    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    breathLoop.start();
    let morphLoop: Animated.CompositeAnimation | null = null;
    if (fireball) {
      morphLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(morph, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(morph, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
      morphLoop.start();
    }
    return () => {
      breathLoop.stop();
      morphLoop?.stop();
    };
  }, [pulseStrength, fireball, breath, morph]);

  // Halo grows with pulseStrength
  const haloScale = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.3 + 0.4 * pulseStrength],
  });
  const haloOpacity = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25 + 0.45 * pulseStrength, 0],
  });
  const coreScaleY = morph.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
  const coreScaleX = morph.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] });

  // Circle size grows with score so high-compat pins are visually heavier
  const size = 26 + Math.round(pulseStrength * 14); // 26 (low) → 40 (high)

  // Fireball variant uses warm 3-stop gradient mimicking flame
  const gradientStops: [string, string] | [string, string, string] = fireball
    ? ["#FFE16B", "#FF6B2A", "#7A0B00"]
    : [top, bottom];

  return (
    <View style={[styles.wrap, { width: size + 24, height: size + 24 }]}>
      {pulseStrength > 0 && (
        <Animated.View
          style={[
            styles.halo,
            {
              width: size + 12, height: size + 12, borderRadius: (size + 12) / 2,
              backgroundColor: glow,
              transform: [{ scale: haloScale }],
              opacity: haloOpacity,
            },
          ]}
        />
      )}
      {/* Inner glow ring for fireball tier */}
      {fireball && (
        <Animated.View
          style={[
            styles.innerHalo,
            {
              width: size + 4, height: size + 4, borderRadius: (size + 4) / 2,
              opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.85] }),
            },
          ]}
        />
      )}
      <View
        style={[
          styles.pinShadow,
          {
            shadowColor: glow,
            shadowOpacity: 0.4 + 0.5 * pulseStrength,
            shadowRadius: 6 + 8 * pulseStrength,
          },
        ]}
      >
        <Animated.View
          style={[
            styles.pin,
            {
              width: size, height: size, borderRadius: size / 2,
              transform: fireball ? [{ scaleX: coreScaleX }, { scaleY: coreScaleY }] : [],
            },
          ]}
        >
          <LinearGradient
            colors={gradientStops as any}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.pinText}>{score}</Text>
        </Animated.View>
      </View>
    </View>
  );
}

// ============================================================================
// TopMatchMarker — the highest-compat spot in view. Reserved for the single
// brightest pin so it stands out even among other fireballs.
// ============================================================================

export function TopMatchMarker({ score }: { score: number }) {
  const halo = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const morph = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const haloLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(halo, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(halo, { toValue: 0, duration: 1400, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 950, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 950, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const morphLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(morph, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(morph, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    haloLoop.start(); breathLoop.start(); morphLoop.start();
    return () => { haloLoop.stop(); breathLoop.stop(); morphLoop.stop(); };
  }, [halo, breath, morph]);

  const haloScale = halo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.65] });
  const haloOpacity = halo.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const breathOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0.95] });
  const coreScaleY = morph.interpolate({ inputRange: [0, 1], outputRange: [1, 1.13] });
  const coreScaleX = morph.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] });

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
          colors={["#FFE16B", "#FF6B2A", "#7A0B00"]}
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
    alignItems: "center", justifyContent: "center",
  },
  dot: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.mute,
    borderWidth: 2, borderColor: "#fff",
  },
  halo: {
    position: "absolute",
  },
  innerHalo: {
    position: "absolute",
    backgroundColor: "#FFB347",
  },
  pinShadow: {
    shadowOffset: { width: 0, height: 0 },
  },
  pin: {
    overflow: "hidden",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.95)",
  },
  pinText: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 0.2 },

  topWrap: { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
  topHalo: {
    position: "absolute",
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.red,
  },
  topGlow: {
    position: "absolute",
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: "#FFB347",
  },
  topCore: {
    width: 42, height: 42, borderRadius: 21,
    overflow: "hidden",
    alignItems: "center", justifyContent: "center",
    shadowColor: colors.red,
    shadowOpacity: 0.85,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.95)",
  },
  coreScore: { color: "#fff", fontSize: 13, fontWeight: "800", letterSpacing: 0.2 },
});
