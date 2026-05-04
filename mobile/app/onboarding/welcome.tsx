import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Logo, LOGO_SIZE } from "../../components/Logo";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { track } from "../../lib/analytics";

// ============================================================================
// Welcome — the mission moment. Premium, calm, decisive.
// "Document your palate. Discover restaurants you didn't know you'd love."
// One screen, one promise. The next tap takes the user into onboarding.
// ============================================================================

export default function Welcome() {
  const router = useRouter();
  const fade = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    void track("onboarding_started");
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(lift, { toValue: 0, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={styles.safe}>
      {/* Premium dark gradient background — sets the tone immediately. */}
      <LinearGradient
        colors={["#0E0E0E", "#1A0604", "#000000"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Subtle red glow behind the headline */}
      <View style={styles.glow} />

      <SafeAreaView style={{ flex: 1, justifyContent: "space-between" }}>
        <Animated.View style={[styles.body, { opacity: fade, transform: [{ translateY: lift }] }]}>
          <Logo size={LOGO_SIZE.hero} />
          <Spacer size={36} />
          <Text style={styles.eyebrow}>WELCOME TO PALATE</Text>
          <Spacer size={12} />
          <Text style={styles.h1}>Document your palate.</Text>
          <Text style={styles.h1Accent}>Discover restaurants you didn't know you'd love.</Text>
          <Spacer size={20} />
          <Text style={styles.p}>
            Every visit you log sharpens your taste profile. Every recommendation gets closer to what you'd actually pick.
          </Text>
        </Animated.View>

        <Animated.View style={[styles.cta, { opacity: fade }]}>
          <Button title="Get started" onPress={() => router.push("/onboarding/profile-setup")} />
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  glow: {
    position: "absolute",
    top: "20%",
    left: "10%",
    right: "10%",
    height: 280,
    borderRadius: 999,
    backgroundColor: colors.red,
    opacity: 0.12,
  },
  body: { padding: spacing.lg, paddingTop: spacing.xxl, marginTop: spacing.xl },
  cta: { padding: spacing.lg },
  eyebrow: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  h1: { color: "#fff", fontSize: 34, fontWeight: "800", letterSpacing: -0.7, lineHeight: 40 },
  h1Accent: { color: colors.red, fontSize: 34, fontWeight: "800", letterSpacing: -0.7, lineHeight: 40, marginTop: 4 },
  p: { color: "rgba(255,255,255,0.78)", fontSize: 16, lineHeight: 24, fontWeight: "500" },
});
