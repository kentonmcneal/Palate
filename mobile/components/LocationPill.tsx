import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../theme";
import { useBrowsingCity } from "../lib/browsing-location";

// ============================================================================
// LocationPill — small chip showing the user's current "browse" location.
// Tap → opens the city picker. Shows "Your location" when no override.
// Used on Home and Discover so trip planning is one tap away.
// ============================================================================

export function LocationPill() {
  const router = useRouter();
  const [city] = useBrowsingCity();
  const label = city ? `${city.name}` : "Your location";

  return (
    <Pressable
      onPress={() => router.push("/location-picker")}
      style={[styles.pill, city && styles.pillActive]}
      accessibilityRole="button"
      accessibilityLabel={`Browsing ${label}. Tap to change.`}
    >
      <View style={[styles.dot, city ? styles.dotActive : styles.dotIdle]} />
      <Text style={[styles.text, city && styles.textActive]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.chev, city && styles.textActive]}>⌄</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
    alignSelf: "flex-start",
  },
  pillActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotIdle: { backgroundColor: colors.mute },
  dotActive: { backgroundColor: colors.red },
  text: { fontSize: 13, fontWeight: "700", color: colors.ink, maxWidth: 180 },
  textActive: { color: "#fff" },
  chev: { fontSize: 12, color: colors.mute, fontWeight: "800" },
});
