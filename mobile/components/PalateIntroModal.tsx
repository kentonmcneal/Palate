import { useEffect, useState } from "react";
import { Modal, View, StyleSheet, Pressable, Animated, Easing } from "react-native";
import { Text } from "./Text";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, spacing } from "../theme";

// ============================================================================
// PalateIntroModal — first-time welcome to the Palate identity system.
// ----------------------------------------------------------------------------
// Shows once, dismissible, never blocks core functionality.
// Stored flag: 'palate.introSeen.v2' — bumped if we ever change the intro.
// ============================================================================

const SEEN_KEY = "palate.introSeen.v2";

export function PalateIntroModal() {
  const [visible, setVisible] = useState(false);
  const fade = useState(new Animated.Value(0))[0];

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(SEEN_KEY);
        if (alive && !seen) {
          // Slight delay so we don't fight the initial app paint
          setTimeout(() => {
            if (!alive) return;
            setVisible(true);
            Animated.timing(fade, {
              toValue: 1, duration: 360, useNativeDriver: true, easing: Easing.out(Easing.cubic),
            }).start();
          }, 600);
        }
      } catch {
        // ignore — intro is optional
      }
    })();
    return () => { alive = false; };
  }, [fade]);

  function dismiss() {
    Animated.timing(fade, {
      toValue: 0, duration: 200, useNativeDriver: true, easing: Easing.in(Easing.cubic),
    }).start(() => setVisible(false));
    void AsyncStorage.setItem(SEEN_KEY, "1").catch(() => {});
  }

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss}>
      <Animated.View style={[styles.scrim, { opacity: fade }]}>
        <View style={styles.card}>
          <LinearGradient
            colors={["#ffffff", "#f5f5f5"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.glow} />

          <Text style={styles.eyebrow}>WELCOME TO PALATE</Text>
          <Text style={styles.headline}>Your personal food diary.</Text>
          <Text style={styles.lede}>
            Your eating patterns reveal who you are right now.
          </Text>

          <View style={styles.bullets}>
            <Bullet text="Log restaurants you visit" />
            <Bullet text="Save places to try later" />
            <Bullet text="Discover your weekly Palate" />
            <Bullet text="Watch your taste evolve" />
          </View>

          <Pressable onPress={dismiss} style={styles.cta}>
            <Text style={styles.ctaText}>Start eating</Text>
          </Pressable>

          <Pressable onPress={dismiss} style={styles.dismiss} hitSlop={12}>
            <Text style={styles.dismissText}>Skip</Text>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 28,
    padding: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    overflow: "hidden",
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  glow: {
    position: "absolute",
    top: -40, left: "20%", right: "20%",
    height: 220,
    borderRadius: 999,
    backgroundColor: colors.red,
    opacity: 0.05,
  },
  eyebrow: {
    color: colors.mute,
    fontSize: 11, fontWeight: "700", letterSpacing: 1.8,
  },
  headline: {
    color: colors.ink,
    fontSize: 28, fontWeight: "800", letterSpacing: -0.6,
    marginTop: 8, lineHeight: 34,
  },
  lede: {
    color: colors.inkDim,
    fontSize: 15, lineHeight: 22, marginTop: 8, fontWeight: "500",
  },

  bullets: { marginTop: spacing.lg, gap: 10 },
  bulletRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bulletDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.red,
  },
  bulletText: { color: colors.inkDim, fontSize: 14, fontWeight: "500" },

  cta: {
    marginTop: spacing.xl,
    minHeight: 50, paddingVertical: 12, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.red,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  ctaText: { color: "#fff", fontSize: 15, fontWeight: "800", letterSpacing: 0.2 },

  dismiss: { alignSelf: "center", marginTop: 14, padding: 6 },
  dismissText: { color: colors.mute, fontSize: 13, fontWeight: "600" },
});
