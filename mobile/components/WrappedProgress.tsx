import { View, Text, StyleSheet } from "react-native";
import { colors, spacing, type } from "../theme";

const TARGET = 3;

export function WrappedProgress({ visitsTotal }: { visitsTotal: number }) {
  if (visitsTotal >= TARGET) return null;
  const remaining = TARGET - visitsTotal;
  const pct = Math.min(1, visitsTotal / TARGET);

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>FIRST WRAPPED PROGRESS</Text>
      <Text style={styles.headline}>
        {remaining === TARGET
          ? `Log ${TARGET} visits to unlock your first Weekly Palate`
          : remaining === 1
            ? "One more visit unlocks your first Weekly Palate"
            : `${remaining} visits away from unlocking your first Weekly Palate`}
      </Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
      </View>
      <View style={styles.dotsRow}>
        {Array.from({ length: TARGET }).map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i < visitsTotal ? styles.dotFilled : styles.dotEmpty]}
          />
        ))}
      </View>
      <Text style={styles.helper}>
        Until then, your Wrapped uses your Starter Palate from the quiz.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.xl,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: "#FFF7F4",
    borderWidth: 1,
    borderColor: "#FFD7CE",
  },
  eyebrow: { ...type.micro, color: colors.red },
  headline: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.ink,
    marginTop: 6,
    lineHeight: 22,
  },
  barTrack: {
    marginTop: 14,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.faint,
    overflow: "hidden",
  },
  barFill: { height: "100%", backgroundColor: colors.red },
  dotsRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  dot: { width: 18, height: 18, borderRadius: 9 },
  dotFilled: { backgroundColor: colors.red },
  dotEmpty: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  helper: { ...type.small, marginTop: 10, fontSize: 12, lineHeight: 18 },
});
