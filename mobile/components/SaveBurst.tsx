import { useEffect, useRef } from "react";
import { Animated, Easing, View, StyleSheet } from "react-native";
import { colors } from "../theme";

// ============================================================================
// SaveBurst — Robinhood-style mini-confetti for save actions. Renders 12
// small dots that scatter outward and fade. Self-cleaning: when `fire` flips
// from 0 → n, the burst plays. Stays mounted invisibly when idle.
// ============================================================================

const PIECE_COUNT = 14;
const COLORS = [colors.red, "#FF6B45", "#FFB68C", "#FFE3D9"];

export function SaveBurst({ fire }: { fire: number }) {
  const pieces = useRef(
    Array.from({ length: PIECE_COUNT }).map((_, i) => ({
      progress: new Animated.Value(0),
      // Distribute evenly around a circle with a little jitter
      angle: (i / PIECE_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5,
      distance: 60 + Math.random() * 40,
      size: 5 + Math.random() * 4,
      color: COLORS[i % COLORS.length],
    })),
  ).current;

  useEffect(() => {
    if (!fire) return;
    pieces.forEach((p) => p.progress.setValue(0));
    Animated.parallel(
      pieces.map((p) =>
        Animated.timing(p.progress, {
          toValue: 1,
          duration: 700 + Math.random() * 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [fire, pieces]);

  return (
    <View pointerEvents="none" style={styles.layer}>
      {pieces.map((p, i) => {
        const tx = p.progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, Math.cos(p.angle) * p.distance],
        });
        const ty = p.progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, Math.sin(p.angle) * p.distance],
        });
        const opacity = p.progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });
        const scale = p.progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 0.6] });
        return (
          <Animated.View
            key={i}
            style={[
              styles.piece,
              {
                width: p.size, height: p.size,
                borderRadius: p.size / 2,
                backgroundColor: p.color,
                transform: [{ translateX: tx }, { translateY: ty }, { scale }],
                opacity,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  piece: { position: "absolute" },
});
