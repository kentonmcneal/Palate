import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { colors } from "../theme";
import { matchScoreColor } from "../lib/match-score";

// ============================================================================
// MatchMarker — circular pin showing % match. Color is on a smooth gradient:
// gray at 0%, brand red at 100%, ramp between. Same gradient as the score
// badges throughout the app, so visual language is consistent.
// ============================================================================

export function MatchMarker({ score }: { score: number | null }) {
  if (score == null) {
    return <View style={styles.dot} />;
  }
  return (
    <View style={[styles.pin, { backgroundColor: matchScoreColor(score) }]}>
      <Text style={styles.pinText}>{score}</Text>
    </View>
  );
}

// ============================================================================
// TopMatchMarker — abstract glowing flame for the top-match nearby spot.
// No emoji. Built from layered Animated.Views: a soft outer halo that pulses
// (heat shimmer), a tighter glow that breathes, and a solid red core that
// subtly morphs vertically (organic flame motion). Tasteful, not cartoony.
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
    haloLoop.start();
    breathLoop.start();
    morphLoop.start();
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
      {/* Outer heat halo — soft, slow pulse */}
      <Animated.View style={[styles.halo, { transform: [{ scale: haloScale }], opacity: haloOpacity }]} />
      {/* Mid breath glow */}
      <Animated.View style={[styles.glow, { transform: [{ scale: breathScale }], opacity: breathOpacity }]} />
      {/* Solid core that morphs vertically — flame-like organic motion */}
      <Animated.View
        style={[
          styles.core,
          { transform: [{ scaleX: coreScaleX }, { scaleY: coreScaleY }] },
        ]}
      >
        <Text style={styles.coreScore}>{score}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.mute,
    borderWidth: 2, borderColor: "#fff",
  },
  pin: {
    minWidth: 40, height: 28,
    paddingHorizontal: 6,
    borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#fff",
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  pinText: { color: "#fff", fontSize: 12, fontWeight: "800" },

  topWrap: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  halo: {
    position: "absolute",
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.red,
  },
  glow: {
    position: "absolute",
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#FF6B45",
  },
  core: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.red,
    alignItems: "center", justifyContent: "center",
    shadowColor: colors.red,
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.85)",
  },
  coreScore: { color: "#fff", fontSize: 11, fontWeight: "800" },
});
