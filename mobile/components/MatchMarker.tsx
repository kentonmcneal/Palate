import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { colors } from "../theme";

// ============================================================================
// MatchMarker — circular red pin showing the % match in the center.
// Lower-match pins fade to a softer red. No match data → small gray dot.
// ============================================================================

export function MatchMarker({ score }: { score: number | null }) {
  if (score == null) {
    return <View style={styles.dot} />;
  }
  const intensity = Math.min(1, Math.max(0.3, (score - 30) / 70));
  const bg = `rgba(255, 48, 8, ${intensity})`;
  return (
    <View style={[styles.pin, { backgroundColor: bg }]}>
      <Text style={styles.pinText}>{score}</Text>
    </View>
  );
}

// ============================================================================
// TopMatchMarker — your highest-match nearby spot. Animated red flame ring
// pulses around a dark centerpiece showing the score. Eye-catcher.
// ============================================================================

export function TopMatchMarker({ score }: { score: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] });

  return (
    <View style={styles.topWrap}>
      <Animated.View
        style={[
          styles.ring,
          { transform: [{ scale: ringScale }], opacity: ringOpacity },
        ]}
      />
      <View style={styles.topPin}>
        <Text style={styles.flame}>🔥</Text>
        <Text style={styles.topScore}>{score}</Text>
      </View>
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

  topWrap: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute",
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.red,
  },
  topPin: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.ink,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2.5, borderColor: colors.red,
    flexDirection: "column",
  },
  flame: { fontSize: 14, marginTop: -2 },
  topScore: { color: "#fff", fontSize: 9, fontWeight: "800", marginTop: -2 },
});
