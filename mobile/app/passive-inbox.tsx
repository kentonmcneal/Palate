import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { track } from "../lib/analytics";
import { getInbox, confirmParamsFor, type InboxEntry } from "../lib/passive-confirm";

// Visits detected during quiet hours or over the daily notification cap land
// here instead of the void. Entries expire after 24h so it never becomes a chore.
export default function PassiveInbox() {
  const router = useRouter();
  const [entries, setEntries] = useState<InboxEntry[]>([]);

  const load = useCallback(async () => setEntries(await getInbox()), []);

  useEffect(() => {
    void track("inbox_opened");
    void load();
  }, [load]);

  function openEntry(entry: InboxEntry) {
    router.push({ pathname: "/confirm-visit", params: confirmParamsFor(entry) });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Recent visits</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.body}
        ListEmptyComponent={
          <View style={styles.card}>
            <Text style={type.subtitle}>Nothing to confirm.</Text>
            <Text style={[type.small, { marginTop: 6 }]}>
              Detected visits waiting on you show up here.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => openEntry(item)} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {new Date(item.detectedAt).toLocaleString()} · {Math.round(item.dwellMin)} min
              </Text>
            </View>
            <Text style={styles.cta}>Confirm</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.faint,
  },
  closeText: { fontSize: 18, fontWeight: "700", color: colors.ink },
  body: { padding: spacing.lg },
  card: {
    padding: spacing.lg, borderRadius: 16, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.paper,
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 14,
    borderRadius: 14, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.paper, marginBottom: 10,
  },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink },
  sub: { ...type.small, marginTop: 2 },
  cta: { color: colors.red, fontWeight: "800", fontSize: 14 },
});
