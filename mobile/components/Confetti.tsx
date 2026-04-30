import { useRef, useEffect } from "react";
import { Dimensions, View, StyleSheet } from "react-native";
import { colors } from "../theme";

// Lazy import so the rest of the app keeps working in environments without
// react-native-confetti-cannon installed (silent no-op fallback).
let ConfettiCannon: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ConfettiCannon = require("react-native-confetti-cannon").default;
} catch {
  ConfettiCannon = null;
}

type Props = {
  /** Toggle to fire a fresh burst. Each new value resets the cannon. */
  fire: boolean;
  /** Big celebrations: 200. Small: 60. Default 120. */
  count?: number;
  /** Duration of fall in ms before fade. Default 3500. */
  fallSpeed?: number;
};

const { width: SCREEN_W } = Dimensions.get("window");

const COLORS = [colors.red, "#FF6B45", "#FFB68C", "#111111", "#FFFFFF"];

/**
 * Brand-colored confetti burst. Wrap this near the top of any screen and
 * toggle `fire` to true to celebrate. Pointer-events disabled so it never
 * blocks taps on the underlying UI.
 *
 * Requires `react-native-confetti-cannon` — if not installed, renders nothing.
 * Run: npx expo install react-native-confetti-cannon
 */
export function Confetti({ fire, count = 120, fallSpeed = 3500 }: Props) {
  const ref = useRef<any>(null);

  useEffect(() => {
    if (fire && ref.current?.start) {
      ref.current.start();
    }
  }, [fire]);

  if (!ConfettiCannon) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <ConfettiCannon
        ref={ref}
        count={count}
        origin={{ x: SCREEN_W / 2, y: 0 }}
        autoStart={false}
        fadeOut
        fallSpeed={fallSpeed}
        explosionSpeed={350}
        colors={COLORS}
      />
    </View>
  );
}
