import { useEffect, useMemo } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  type SharedValue,
} from "react-native-reanimated";
import { colors } from "../theme";

// ============================================================================
// Confetti — brand-colored celebration burst, built on Reanimated (New-Arch
// native). Replaces the old react-native-confetti-cannon dependency; the
// public API (fire / count / fallSpeed) is unchanged so every call site keeps
// working. Pointer-events disabled so it never blocks taps underneath.
//
// One shared `progress` value (0→1) drives every particle on the UI thread;
// each particle's spread, drift, spin, size, and color are randomized once so
// the burst reads as confetti without per-frame JS work.
// ============================================================================

type Props = {
  /** Toggle truthy to fire a burst. */
  fire: boolean;
  /** Big celebrations: ~180. Small: ~60. Default 120. */
  count?: number;
  /** Fall duration in ms before the pieces fade out. Default 3500. */
  fallSpeed?: number;
};

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const COLORS = [colors.red, "#FF6B45", "#FFB68C", "#111111", "#FFFFFF"];

type Particle = {
  startX: number; // absolute left, spread around center-top (the "explosion")
  driftX: number; // horizontal travel over the fall
  fallY: number; // vertical travel (off the bottom edge)
  size: number;
  color: string;
  spin: number; // total rotation in radians over the fall
  round: boolean;
};

function buildParticles(count: number): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const size = 6 + Math.random() * 8;
    out.push({
      startX: SCREEN_W / 2 + (Math.random() - 0.5) * SCREEN_W * 0.5,
      driftX: (Math.random() - 0.5) * SCREEN_W * 0.9,
      fallY: SCREEN_H + 40,
      size,
      color: COLORS[i % COLORS.length],
      spin: (Math.random() - 0.5) * 8,
      round: Math.random() < 0.35,
    });
  }
  return out;
}

export function Confetti({ fire, count = 120, fallSpeed = 3500 }: Props) {
  const progress = useSharedValue(0);
  const particles = useMemo(() => buildParticles(count), [count]);

  useEffect(() => {
    if (!fire) return;
    progress.value = 0;
    progress.value = withTiming(1, { duration: fallSpeed, easing: Easing.out(Easing.quad) });
  }, [fire, fallSpeed, progress]);

  if (!fire) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {particles.map((p, i) => (
        <ConfettiPiece key={i} p={p} progress={progress} />
      ))}
    </View>
  );
}

function ConfettiPiece({ p, progress }: { p: Particle; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const t = progress.value;
    // Fade only over the last 15% so pieces stay fully visible while falling.
    const opacity = t < 0.85 ? 1 : Math.max(0, 1 - (t - 0.85) / 0.15);
    return {
      opacity,
      transform: [
        { translateX: p.driftX * t },
        { translateY: p.fallY * t },
        { rotate: `${p.spin * t}rad` },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: p.startX,
          top: -20,
          width: p.size,
          height: p.round ? p.size : p.size * 0.4,
          borderRadius: p.round ? p.size / 2 : 2,
          backgroundColor: p.color,
        },
        style,
      ]}
    />
  );
}
