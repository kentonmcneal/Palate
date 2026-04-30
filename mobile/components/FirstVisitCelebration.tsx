import { useEffect, useRef } from "react";
import { Modal, View, Text, StyleSheet, Pressable, Animated, Easing } from "react-native";
import { colors, spacing, type } from "../theme";

type Props = {
  visible: boolean;
  restaurantName: string;
  onDismiss: () => void;
};

/**
 * One-time celebration shown when the user logs their *first* visit ever.
 * Designed to make a first-time user feel like they've crossed a threshold,
 * not just filled in a form.
 */
export function FirstVisitCelebration({ visible, restaurantName, onDismiss }: Props) {
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 240, useNativeDriver: true }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 360,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      scale.setValue(0.85);
      opacity.setValue(0);
    }
  }, [visible, scale, opacity]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.scrim}>
        <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
          <Text style={styles.confetti}>✦  ✦  ✦</Text>
          <Text style={styles.eyebrow}>YOUR FIRST VISIT</Text>
          <Text style={styles.title}>Your Palate is{" "}
            <Text style={styles.titleAccent}>forming.</Text>
          </Text>
          <Text style={styles.body}>
            You just logged{" "}
            <Text style={styles.bodyStrong}>{restaurantName}</Text>. From here, every visit
            sharpens your weekly Wrapped — your real eating personality, by Sunday.
          </Text>
          <Pressable onPress={onDismiss} style={styles.cta} accessibilityRole="button">
            <Text style={styles.ctaText}>Let's go</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(15,15,15,0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.paper,
    borderRadius: 28,
    padding: spacing.lg,
    paddingTop: 28,
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
  },
  confetti: { fontSize: 22, color: colors.red, letterSpacing: 6, marginBottom: 14 },
  eyebrow: { ...type.micro },
  title: {
    marginTop: 8,
    color: colors.ink,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.6,
    lineHeight: 32,
    textAlign: "center",
  },
  titleAccent: { color: colors.red },
  body: {
    marginTop: 14,
    color: colors.mute,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  bodyStrong: { color: colors.ink, fontWeight: "700" },
  cta: {
    marginTop: 24,
    backgroundColor: colors.red,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
    width: "100%",
    alignItems: "center",
  },
  ctaText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});
