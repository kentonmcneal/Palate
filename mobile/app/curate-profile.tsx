import { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Switch, ActivityIndicator, Pressable } from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { Button, Spacer } from "../components/Button";
import { track } from "../lib/analytics";
import { listVisitsForCuration, setVisitVisibility } from "../lib/visits";
import { defaultVisitVisibility, visibilityReasonLabel } from "../lib/visit-visibility";

// Curating the public profile.
//
// The ledger stays complete either way — recommendations, the taste graph,
// Wrapped and insights read every visit regardless of what is hidden here.
// This screen governs one thing: what other people see. The copy has to make
// that unambiguous, or hiding a visit feels like deleting it.

type Row = Awaited<ReturnType<typeof listVisitsForCuration>>[number];

export default function CurateProfile() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setRows(await listVisitsForCuration());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggle(row: Row, next: boolean) {
    // Optimistic: a visibility toggle that lags feels broken, and the write is
    // small. Reverted below if it fails.
    setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, is_public: next } : r)) ?? prev);
    setPending((p) => new Set(p).add(row.id));
    try {
      await setVisitVisibility(row.id, next);
      void track(next ? "visit_shown" : "visit_hidden", {
        place_id: row.restaurant?.google_place_id ?? null,
      });
    } catch {
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, is_public: !next } : r)) ?? prev);
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(row.id); return n; });
    }
  }

  if (!rows) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
      </SafeAreaView>
    );
  }

  const shown = rows.filter((r) => r.is_public).length;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.h1}>What friends see</Text>
        <Text style={styles.sub}>
          Everything you log stays in your history and keeps shaping your recommendations.
          This only controls what shows on your profile.
        </Text>
        <Spacer />
        <Text style={type.micro}>{shown} OF {rows.length} SHOWN</Text>

        {rows.length === 0 && (
          <View style={styles.card}>
            <Text style={type.small}>No visits yet. Log one and it'll appear here.</Text>
          </View>
        )}

        <View style={{ marginTop: spacing.md }}>
          {rows.map((row) => {
            const suggestion = defaultVisitVisibility(row.restaurant as never);
            return (
              <View key={row.id} style={styles.row}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.name}>{row.restaurant?.name ?? "Unknown place"}</Text>
                  <Text style={styles.meta}>
                    {new Date(row.visited_at).toLocaleDateString()}
                    {/* Explain the suggestion only when it disagrees with the
                        current state, so the hint is information rather than
                        noise on every row. */}
                    {row.is_public !== suggestion.isPublic
                      ? ` · ${visibilityReasonLabel(suggestion.reason)}`
                      : ""}
                  </Text>
                </View>
                <Switch
                  value={row.is_public}
                  disabled={pending.has(row.id)}
                  onValueChange={(v) => { void toggle(row, v); }}
                  thumbColor={row.is_public ? colors.red : "#fff"}
                  trackColor={{ true: colors.redTintBorder, false: colors.line }}
                />
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button title="Done" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.line },
  h1: { ...type.display, color: colors.ink },
  sub: { ...type.body, color: colors.mute, marginTop: 8, lineHeight: 22 },
  card: {
    borderColor: colors.line, borderWidth: 1, borderRadius: 18,
    padding: spacing.lg, backgroundColor: colors.faint, marginTop: spacing.lg,
  },
  row: {
    flexDirection: "row", alignItems: "center",
    borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 14,
  },
  name: { ...type.subtitle, color: colors.ink },
  meta: { ...type.small, color: colors.mute, marginTop: 2 },
});
