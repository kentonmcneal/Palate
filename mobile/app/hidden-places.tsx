import { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { listDislikes, restorePlace, REASON_LABEL, type DislikeRow } from "../lib/dislikes";
import { invalidatePersonalSignal } from "../lib/personal-signal";
import { invalidateCompatibilityCache } from "../lib/recommendation";
import { loadView } from "../lib/load-state";
import { LoadError } from "../components/LoadError";

// Everything you said "Not interested" to, with the reason, and a way back.
// Permanent is only honest if it is reversible somewhere.
export default function HiddenPlaces() {
  const router = useRouter();
  const [rows, setRows] = useState<DislikeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listDislikes());
      setError(null);
    } catch (e: any) {
      setError(e ?? new Error("hidden places load failed"));
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { setLoading(true); void load(); }, [load]));

  async function restore(r: DislikeRow) {
    setBusy(r.google_place_id);
    try {
      await restorePlace(r.google_place_id);
      invalidatePersonalSignal();
      invalidateCompatibilityCache();
      setRows((cur) => cur.filter((x) => x.google_place_id !== r.google_place_id));
    } catch (e: any) {
      Alert.alert("Couldn't restore", e?.message ?? "Try again");
    } finally {
      setBusy(null);
    }
  }

  const view = loadView({ loading, error, count: rows.length });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Hidden places</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {view === "loading" && <View style={styles.center}><ActivityIndicator color={colors.red} /></View>}
        {view === "error" && <LoadError error={error} onRetry={() => { setLoading(true); void load(); }} />}
        {view === "empty" && (
          <View style={styles.empty}>
            <Text style={type.subtitle}>Nothing hidden.</Text>
            <Text style={[type.small, { marginTop: 6, lineHeight: 20 }]}>
              Tap ✕ on any recommendation to say you're not interested. It disappears for good, Palate learns from why, and it shows up here in case you change your mind.
            </Text>
          </View>
        )}
        {view === "content" && rows.map((r) => (
          <View key={r.google_place_id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{r.restaurant_name ?? "A place"}</Text>
              <Text style={type.small}>
                {REASON_LABEL[r.reason]}{r.cuisine_type ? ` · ${r.cuisine_type}` : ""}
              </Text>
            </View>
            <Pressable onPress={() => restore(r)} disabled={busy === r.google_place_id} style={styles.restore}>
              <Text style={styles.restoreText}>{busy === r.google_place_id ? "…" : "Bring back"}</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  closeBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.faint },
  closeText: { fontSize: 18, fontWeight: "700", color: colors.ink },
  body: { padding: spacing.lg, paddingBottom: 60 },
  center: { padding: 48, alignItems: "center" },
  empty: { padding: spacing.lg, borderRadius: 18, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
  restore: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.faint },
  restoreText: { fontSize: 13, fontWeight: "700", color: colors.ink },
});
