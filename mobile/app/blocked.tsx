import { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Avatar } from "../components/Avatar";
import { colors, spacing, type } from "../theme";
import { listBlockedUsers, unblockUser, type BlockedProfile } from "../lib/moderation";
import { loadView } from "../lib/load-state";
import { LoadError } from "../components/LoadError";

export default function BlockedAccounts() {
  const router = useRouter();
  const [rows, setRows] = useState<BlockedProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // A failed load here used to render "You haven't blocked anyone", which is
  // not an empty state, it is a claim about who can see you. Of every screen
  // in the app this is the worst one to be confidently wrong on.
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listBlockedUsers());
      setError(null);
    } catch (e: any) {
      setError(e ?? new Error("blocked load failed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  function confirmUnblock(row: BlockedProfile) {
    const name = row.display_name || row.email || "this person";
    Alert.alert(`Unblock ${name}?`, "Their posts can appear in your feed again. You won't be re-added as friends.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unblock",
        onPress: async () => {
          setBusyId(row.id);
          try { await unblockUser(row.id); setRows((r) => r.filter((x) => x.id !== row.id)); }
          catch (e: any) { Alert.alert("Couldn't unblock", e?.message ?? "Try again"); }
          finally { setBusyId(null); }
        },
      },
    ]);
  }

  const view = loadView({ loading, error, count: rows.length });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Blocked</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {view === "loading" && <View style={styles.center}><ActivityIndicator color={colors.red} /></View>}

        {view === "error" && (
          <LoadError error={error} onRetry={() => { setLoading(true); setError(null); load(); }} />
        )}

        {view === "empty" && (
          <View style={styles.empty}>
            <Text style={type.subtitle}>You haven't blocked anyone.</Text>
            <Text style={[type.small, { marginTop: 8, lineHeight: 20 }]}>
              Blocking someone hides their posts from your feed and removes you as friends. You can undo it here anytime.
            </Text>
          </View>
        )}

        {view === "content" && rows.map((row) => {
          const name = row.display_name || (row.email ? row.email.split("@")[0] : "Unknown");
          return (
            <View key={row.id} style={styles.row}>
              <Avatar uri={row.avatar_url} name={row.display_name} email={row.email} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{name}</Text>
                {row.email && <Text style={type.small}>{row.email}</Text>}
              </View>
              <Pressable onPress={() => confirmUnblock(row)} disabled={busyId === row.id} style={styles.unblockBtn}>
                <Text style={styles.unblockText}>{busyId === row.id ? "…" : "Unblock"}</Text>
              </Pressable>
            </View>
          );
        })}
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
  closeText: { fontSize: 18, fontWeight: "700", color: colors.ink },
  body: { padding: spacing.lg, paddingBottom: 80 },
  center: { padding: 60, alignItems: "center" },
  empty: { padding: spacing.lg, borderRadius: 18, borderWidth: 1, borderColor: colors.line },

  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, borderBottomColor: colors.line, borderBottomWidth: 1,
  },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink },
  unblockBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  unblockText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
});
