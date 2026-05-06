import { useEffect, useState } from "react";
import { Modal, View, Text, StyleSheet, Pressable, Animated, Easing } from "react-native";
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
            colors={["#1A0604", "#000000"]}
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
    backgroundColor: "#000",
  },
  glow: {
    position: "absolute",
    top: -40, left: "20%", right: "20%",
    height: 220,
    borderRadius: 999,
    backgroundColor: colors.red,
    opacity: 0.15,
  },
  eyebrow: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11, fontWeight: "700", letterSpacing: 1.8,
  },
  headline: {
    color: "#fff",
    fontSize: 28, fontWeight: "800", letterSpacing: -0.6,
    marginTop: 8, lineHeight: 34,
  },
  lede: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 15, lineHeight: 22, marginTop: 8, fontWeight: "500",
  },

  bullets: { marginTop: spacing.lg, gap: 10 },
  bulletRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bulletDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.red,
  },
  bulletText: { color: "rgba(255,255,255,0.85)", fontSize: 14, fontWeight: "500" },

  cta: {
    marginTop: spacing.xl,
    height: 50, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.red,
    shadowColor: colors.red,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  ctaText: { color: "#fff", fontSize: 15, fontWeight: "800", letterSpacing: 0.2 },

  dismiss: { alignSelf: "center", marginTop: 14, padding: 6 },
  dismissText: { color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: "600" },
});
