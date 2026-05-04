import { useState, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import {
  POPULAR_CITIES, setBrowsingCity, useBrowsingCity, type BrowsingCity,
} from "../lib/browsing-location";
import { triggerHapticSelection } from "../lib/haptics";

// ============================================================================
// Location picker — tap a city to browse it (recommendations, lists, map all
// re-center). Tap "Use my location" to clear the override.
// Searchable; popular cities sit on top.
// ============================================================================

export default function LocationPickerScreen() {
  const router = useRouter();
  const [active] = useBrowsingCity();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return POPULAR_CITIES;
    return POPULAR_CITIES.filter((c) =>
      c.name.toLowerCase().includes(q) || c.region.toLowerCase().includes(q),
    );
  }, [query]);

  async function pick(city: BrowsingCity | null) {
    void triggerHapticSelection();
    await setBrowsingCity(city);
    router.back();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>×</Text>
        </Pressable>
        <Text style={type.title}>Browse a city</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search city or state…"
          placeholderTextColor={colors.mute}
          style={styles.search}
          autoCapitalize="words"
          autoCorrect={false}
        />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Reset to real GPS */}
        <Pressable onPress={() => pick(null)} style={[styles.row, !active && styles.rowActive]}>
          <View style={[styles.dot, !active ? styles.dotActive : styles.dotIdle]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Use my location</Text>
            <Text style={styles.rowSub}>Wherever you are right now</Text>
          </View>
          {!active && <Text style={styles.check}>✓</Text>}
        </Pressable>

        <View style={styles.divider} />

        {filtered.map((c) => {
          const isActive = active?.id === c.id;
          return (
            <Pressable
              key={c.id}
              onPress={() => pick(c)}
              style={[styles.row, isActive && styles.rowActive]}
            >
              <View style={[styles.dot, isActive ? styles.dotActive : styles.dotIdle]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{c.name}</Text>
                <Text style={styles.rowSub}>{c.region}</Text>
              </View>
              {isActive && <Text style={styles.check}>✓</Text>}
            </Pressable>
          );
        })}

        {filtered.length === 0 && (
          <Text style={[type.small, { textAlign: "center", marginTop: 24, lineHeight: 22 }]}>
            No matches in our city list yet. Tap "Use my location" to browse where you are.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.line, borderBottomWidth: 1,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.faint,
  },
  closeText: { fontSize: 22, fontWeight: "700", color: colors.ink },

  searchRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  search: {
    height: 44, borderRadius: 12,
    borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink,
    backgroundColor: colors.paper,
  },

  body: { padding: spacing.lg, paddingBottom: 80 },

  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 14, paddingHorizontal: 12,
    borderRadius: 14,
  },
  rowActive: { backgroundColor: colors.faint },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotIdle: { backgroundColor: colors.line },
  dotActive: { backgroundColor: colors.red },
  rowLabel: { fontSize: 15, fontWeight: "700", color: colors.ink },
  rowSub: { fontSize: 12, color: colors.mute, marginTop: 2 },
  check: { color: colors.red, fontSize: 18, fontWeight: "800" },

  divider: { height: 1, backgroundColor: colors.line, marginVertical: 6 },
});
