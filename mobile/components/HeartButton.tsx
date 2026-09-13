// ----------------------------------------------------------------------------
// HeartButton — the like, the way people already expect a like to behave.
// ----------------------------------------------------------------------------
// Replaces a "Kudos" pill. Kudos was Strava's word and the reasoning for it was
// sound -- "I saw this and it counts" is what a like on somebody's dinner
// means -- but nobody had to be taught what a heart does, and a pill that
// changes colour is not an interaction anyone feels. Asked for explicitly:
// make it Instagram's.
//
// What Instagram's heart actually does, and why each part earns its place:
//
//   • It pops. Scale 1 -> 1.28 -> 1, spring, ~220ms. The tap gets a physical
//     answer, which is the entire reason the gesture feels good rather than
//     merely working.
//   • It fills. Outline when unliked, solid red when liked. State is readable
//     at a glance, without reading a word.
//   • The count sits beside it and changes instantly. Nobody waits on a
//     network round trip to see their own tap register.
//   • Unliking does NOT pop. The animation is a reward; playing it while
//     taking the like away is a mixed signal.
//
// Drawn with Text glyphs rather than an icon dependency: the app has no icon
// set, and adding one for two shapes would mean a native rebuild -- which
// would strand this behind a store release instead of shipping over the air.
// ----------------------------------------------------------------------------
import { useRef } from "react";
import { Animated, Pressable, StyleSheet, View, Easing } from "react-native";
import { Text } from "./Text";
import { colors, type } from "../theme";
import { FONT_CAP } from "../lib/a11y";
import { triggerHapticSelection } from "../lib/haptics";

export function HeartButton({
  liked, count, onToggle, size = 26, showZero = false,
}: {
  liked: boolean;
  count: number;
  onToggle: () => void;
  size?: number;
  /** Comment hearts hide a zero; post hearts show the number once there is one. */
  showZero?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  function pop() {
    scale.setValue(0.8);
    Animated.spring(scale, {
      toValue: 1,
      friction: 3,
      tension: 160,
      useNativeDriver: true,
    }).start();
  }

  function handlePress() {
    // Fire the animation and the haptic on the way IN, not after the await:
    // the feedback is for the tap, and a spinner's worth of delay is exactly
    // what makes a like feel broken.
    if (!liked) {
      pop();
      void triggerHapticSelection();
    }
    onToggle();
  }

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={10}
      style={styles.wrap}
      accessibilityRole="button"
      accessibilityState={{ selected: liked }}
      accessibilityLabel={liked ? `Unlike, ${count} likes` : `Like, ${count} likes`}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Text
          style={[
            styles.glyph,
            { fontSize: size, lineHeight: size * 1.15 },
            liked ? styles.on : styles.off,
          ]}
          maxFontSizeMultiplier={FONT_CAP.chrome}
        >
          {liked ? "♥" : "♡"}
        </Text>
      </Animated.View>
      {(count > 0 || showZero) && (
        <Text style={styles.count} maxFontSizeMultiplier={FONT_CAP.chrome}>
          {count}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * The big heart that blooms over a post on double tap, then fades.
 * Purely decorative — the state change is the HeartButton's job.
 */
export function HeartBurst({ trigger }: { trigger: number }) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const last = useRef(trigger);

  if (trigger !== last.current) {
    last.current = trigger;
    scale.setValue(0.4);
    opacity.setValue(0.95);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
      Animated.timing(opacity, {
        toValue: 0, duration: 700, delay: 250,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
    ]).start();
  }

  return (
    <View pointerEvents="none" style={styles.burstWrap}>
      <Animated.Text style={[styles.burst, { opacity, transform: [{ scale }] }]}>♥</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  glyph: { textAlign: "center" },
  on: { color: colors.red },
  // Near-black outline, not grey: an unfilled heart in mute read as disabled.
  off: { color: colors.ink },
  count: { ...type.small, fontWeight: "700", color: colors.ink },
  burstWrap: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center", justifyContent: "center",
  },
  burst: { fontSize: 92, color: "#fff", textShadowColor: "rgba(0,0,0,0.25)", textShadowRadius: 12 },
});
