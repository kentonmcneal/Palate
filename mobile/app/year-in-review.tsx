import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { colors, spacing, type } from "../theme";

const TARGET_DATE = new Date("2026-12-15");

function daysUntilDrop(): number {
  const ms = TARGET_DATE.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export default function YearInReviewPlaceholder() {
  const router = useRouter();
  const days = daysUntilDrop();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.gradient}>
        <LinearGradient
          colors={["#1A1A1A", "#0E0E0E"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <View style={styles.glow} />

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.eyebrow}>COMING DECEMBER 2026</Text>
          <Text style={styles.h1}>
            Your Year in <Text style={styles.accent}>Palate</Text>.
          </Text>
          <Text style={styles.lede}>
            Every visit you log this year becomes part of one beautiful card —
            your year in restaurants, dishes, neighborhoods, and the
            personality you turned out to be.
          </Text>

          <View style={styles.countdownBox}>
            <Text style={styles.countdownNumber}>{days}</Text>
            <Text style={styles.countdownLabel}>days until your reveal</Text>
          </View>

          <View style={styles.feature}>
            <Text style={styles.featureTitle}>What you'll see</Text>
            <Text style={styles.featureLine}>· Your top 5 restaurants of the year</Text>
            <Text style={styles.featureLine}>· The cuisine you ate most (and the one you almost ignored)</Text>
            <Text style={styles.featureLine}>· How your Palate evolved month over month</Text>
            <Text style={styles.featureLine}>· One stat you'll text someone</Text>
          </View>

          <View style={styles.feature}>
            <Text style={styles.featureTitle}>To get the full experience</Text>
            <Text style={styles.featureLine}>
              Just keep logging visits. Every tap counts toward your year.
            </Text>
          </View>

          <Pressable style={styles.cta} onPress={() => router.back()}>
            <Text style={styles.ctaText}>Got it</Text>
          </Pressable>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  gradient: { flex: 1, position: "relative", overflow: "hidden" },
  glow: {
    position: "absolute",
    top: -120,
    right: -100,
    width: 360,
    height: 360,
    borderRadius: 360,
    backgroundColor: colors.red,
    opacity: 0.22,
  },
  body: { padding: spacing.lg, paddingTop: spacing.xxl, paddingBottom: spacing.xxl },
  eyebrow: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "600", letterSpacing: 2 },
  h1: {
    color: "#fff",
    fontSize: 38,
    fontWeight: "800",
    letterSpacing: -1,
    marginTop: 16,
    lineHeight: 42,
  },
  accent: { color: colors.red },
  lede: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 18,
  },
  countdownBox: {
    marginTop: 32,
    alignItems: "center",
    padding: spacing.lg,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  countdownNumber: { color: colors.red, fontSize: 64, fontWeight: "800", letterSpacing: -2 },
  countdownLabel: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 6,
  },
  feature: {
    marginTop: 32,
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  featureTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 10,
  },
  featureLine: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 22,
  },
  cta: {
    marginTop: 36,
    backgroundColor: colors.red,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: "center",
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
