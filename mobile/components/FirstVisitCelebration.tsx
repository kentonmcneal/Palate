import { useEffect, useRef, useState } from "react";
import { Modal, View, StyleSheet, Pressable, Animated, Easing, Share } from "react-native";
import { Text } from "./Text";
import { colors, spacing, type } from "../theme";
import { Confetti } from "./Confetti";
import { generateInviteLink } from "../lib/referrals";
import { requestFullNotificationPermission } from "../lib/notifications";

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
  const [confettiKey, setConfettiKey] = useState(0);

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
      // Fire confetti after the modal scales in (~360ms)
      setTimeout(() => setConfettiKey((k) => k + 1), 380);
    } else {
      scale.setValue(0.85);
      opacity.setValue(0);
    }
  }, [visible, scale, opacity]);

  /**
   * The one moment worth spending iOS's single notification dialog on.
   *
   * Onboarding asks PROVISIONALLY (see ensureNotificationPermission), which is
   * silent and delivers quietly. This is where we go for the loud version:
   * they have just logged their first visit, the confetti is on screen, and
   * the thing we want permission to send — the evening question — is the
   * obvious next step rather than an abstraction.
   *
   * Asking before this point is asking a stranger for their attention. Asking
   * here is asking somebody who just used the product.
   *
   * Fire-and-forget with a catch: a permission prompt must never take down a
   * celebration, and a refusal is not an error.
   */
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      void requestFullNotificationPermission().catch(() => {});
    }, 2200); // after the confetti, before they dismiss
    return () => clearTimeout(t);
  }, [visible]);

  async function handleShare() {
    try {
      const link = await generateInviteLink();
      await Share.share({
        message: `Just logged my first visit on Palate 🍴 It builds your taste identity from where you actually eat. Add me and compare palates:\n\n${link}`,
      });
    } catch {
      // user cancelled or share unavailable — no-op
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Confetti fire={confettiKey > 0} count={150} />
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
            sharpens your taste identity. Your first reveal lands Sunday morning.
          </Text>
          <Pressable onPress={onDismiss} style={styles.cta} accessibilityRole="button">
            <Text style={styles.ctaText}>Let's go</Text>
          </Pressable>
          <Pressable onPress={handleShare} style={styles.shareLink} accessibilityRole="button">
            <Text style={styles.shareLinkText}>Share your first visit →</Text>
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
  shareLink: { marginTop: 14, paddingVertical: 6 },
  shareLinkText: { color: colors.red, fontWeight: "700", fontSize: 14 },
});
