import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Confetti } from "./Confetti";
import { colors } from "../theme";

// ============================================================================
// VisitCelebration — small celebration shown after a visit is logged via the
// "I went here" / Auto-detect / Check now path. Renders:
//   • A short confetti burst (uses brand red/orange palette)
//   • A toast: "Added to your Palate."
// Non-blocking: pointer events disabled, sits absolute, auto-dismisses.
//
// For the FIRST-EVER visit, FirstVisitCelebration takes over instead — that
// stays its own thing.
// ============================================================================

const TOAST_TOTAL_MS = 1800;   // total visible time
const CONFETTI_MS = 1100;      // confetti duration

type Props = {
  /** Bump this number to trigger a celebration. 0 = idle. */
  fire: number;
  /** Optional override copy. Defaults to "Added to your Palate." */
  message?: string;
};

export function VisitCelebration({ fire, message }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(8)).current;
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!fire) return;
    setActive(true);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(translate, {
        toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start();

    const hide = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(translate, { toValue: 8, duration: 220, useNativeDriver: true }),
      ]).start(() => setActive(false));
    }, TOAST_TOTAL_MS);

    return () => clearTimeout(hide);
  }, [fire, opacity, translate]);

  return (
    <View pointerEvents="none" style={styles.layer}>
      <Confetti fire={fire > 0} count={70} fallSpeed={CONFETTI_MS} />
      {active && (
        <Animated.View
          style={[
            styles.toast,
            { opacity, transform: [{ translateY: translate }] },
          ]}
        >
          <Text style={styles.toastText}>{message ?? "Added to your Palate."}</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    left: 0, right: 0, top: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 120,
  },
  toast: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.ink,
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  toastText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
