// ============================================================================
// Flame — an actual flame, not an emoji in a pulsating circle.
// ============================================================================
// The hottest pin on the hype map was a 🔥 glyph inside a breathing disc. The
// disc moved; the flame did not. Asked for directly: make it a moving flame.
//
// Three stacked SVG layers, each with its OWN loop at its own speed and phase:
//
//   outer  deep ember, slowest and widest              ~900ms
//   mid    orange body, out of step with the outer     ~700ms
//   core   saffron heart, fastest, also shimmers       ~520ms
//
// That mismatch is the whole trick. Three layers breathing in unison reads as
// one object being squeezed; three layers on coprime-ish timings never repeat
// the same silhouette twice and read as combustion. Each also squashes
// horizontally as it stretches vertically, the way something made of moving
// gas does, and rocks a couple of degrees off vertical.
//
// A flame burns from its base, so every layer is pinned at the bottom: React
// Native has no transform-origin, so the translateY below is computed to undo
// exactly the drift that scaling from the centre would introduce.
//
// react-native-svg and Animated are both already in the bundle — no new native
// dependency, so this ships over the air rather than waiting for a build.
//
// Respects Reduce Motion. Someone who has asked the OS to stop things moving
// has asked this too, and a flame is decoration, not information.
// ============================================================================
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";
import Svg, { Path } from "react-native-svg";

const VB_W = 24;
const VB_H = 32;

// Silhouettes, largest to smallest.
//
// The first attempt was three concentric symmetric teardrops, and rendering it
// showed exactly what it was: a water drop. A flame is not symmetric. What
// makes the shape read as fire is the S-curve up the leading edge, the notch
// where the body folds back on itself, and the smaller lick rising beside the
// main tongue. Each layer repeats that character at its own scale, so the
// inner ones are not simply the outer one shrunk.
const OUTER =
  "M12 31 C5.4 31 3 26.4 3 21.6 C3 17 6.2 13.4 8.4 10.2 C10.1 7.8 11 5 11 2 " +
  "C13.8 4.6 15.4 7.6 15.4 10.6 C15.4 12.4 14.9 14 14.1 15.4 C15.6 14.6 16.7 13 17.2 11 " +
  "C19.8 14 21 17.6 21 21.6 C21 26.4 18.6 31 12 31 Z";
const MID =
  "M12 28.6 C8.4 28.6 7 25.8 7 22.8 C7 19.9 8.9 17.7 10.3 15.4 C11.3 13.8 11.8 12.1 11.8 10.4 " +
  "C13.4 12.1 14.4 13.9 14.4 15.9 C14.4 17 14.1 18 13.7 18.9 C14.5 18.4 15.1 17.5 15.4 16.3 " +
  "C16.7 18.2 17.2 20.2 17.2 22.8 C17.2 25.8 15.6 28.6 12 28.6 Z";
const CORE =
  "M12 26.8 C10 26.8 9.2 25.2 9.2 23.5 C9.2 21.8 10.4 20.5 11.2 19.2 C11.8 18.2 12.1 17.2 12.1 16.2 " +
  "C13.1 17.3 13.7 18.6 13.7 19.8 C13.7 20.5 13.5 21.1 13.3 21.7 C13.8 21.4 14.2 20.9 14.4 20.2 " +
  "C15.1 21.4 15.4 22.4 15.4 23.5 C15.4 25.2 14 26.8 12 26.8 Z";

type LayerSpec = {
  d: string;
  fill: string;
  duration: number;
  stretch: number;   // how far scaleY travels
  tilt: number;      // degrees of rock
  shimmer: boolean;
};

const LAYERS: LayerSpec[] = [
  { d: OUTER, fill: "#C2603A", duration: 900, stretch: 0.08, tilt: 2,   shimmer: false },
  { d: MID,   fill: "#E0473C", duration: 700, stretch: 0.13, tilt: 3.5, shimmer: false },
  { d: CORE,  fill: "#E8A54A", duration: 520, stretch: 0.17, tilt: 5,   shimmer: true  },
];

export function Flame({ size = 28 }: { size?: number }) {
  const [still, setStill] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { if (alive) setStill(on); })
      .catch(() => { /* an unreadable setting is not a reason to stop moving */ });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => setStill(on));
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  const w = size * (VB_W / VB_H);
  return (
    <View style={{ width: w, height: size }}>
      {LAYERS.map((l, i) => (
        <Layer key={i} spec={l} width={w} height={size} still={still} />
      ))}
    </View>
  );
}

function Layer({
  spec, width, height, still,
}: { spec: LayerSpec; width: number; height: number; still: boolean }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (still) { t.setValue(0.5); return; }
    const leg = (to: number) =>
      Animated.timing(t, {
        toValue: to,
        duration: spec.duration,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      });
    const loop = Animated.loop(Animated.sequence([leg(1), leg(0)]));
    loop.start();
    return () => loop.stop();
  }, [t, spec.duration, still]);

  const scaleY = t.interpolate({
    inputRange: [0, 1],
    outputRange: [1 - spec.stretch, 1 + spec.stretch],
  });
  // Squash as it stretches: a flame conserves its bulk rather than simply
  // getting bigger, and scaling both axes together just looks like a zoom.
  const scaleX = t.interpolate({
    inputRange: [0, 1],
    outputRange: [1 + spec.stretch * 0.6, 1 - spec.stretch * 0.6],
  });
  // Pin the base. scaleY about the centre lifts the bottom edge by
  // height*(s-1)/2, so push back down by exactly that.
  const translateY = t.interpolate({
    inputRange: [0, 1],
    outputRange: [(height * -spec.stretch) / 2, (height * spec.stretch) / 2],
  });
  const rotate = t.interpolate({
    inputRange: [0, 1],
    outputRange: [`-${spec.tilt}deg`, `${spec.tilt}deg`],
  });
  const opacity = spec.shimmer
    ? t.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] })
    : 1;

  return (
    <Animated.View
      style={{
        position: "absolute", left: 0, top: 0, width, height,
        opacity,
        transform: [{ translateY }, { rotate }, { scaleX }, { scaleY }],
      }}
    >
      <Svg width={width} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`}>
        <Path d={spec.d} fill={spec.fill} />
      </Svg>
    </Animated.View>
  );
}
