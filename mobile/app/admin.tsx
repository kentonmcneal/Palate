import { useCallback, useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { isAdmin, listPendingUsers, setApproval, type PendingUser } from "../lib/waitlist";

export default function AdminWaitlistScreen() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const admin = await isAdmin();
      setAllowed(admin);
      if (admin) setPending(await listPendingUsers());
    } catch (e: any) {
      Alert.alert("Couldn't load", e?.message ?? "Try again");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, status: "approved" | "rejected") {
    setActing(id);
    try {
      await setApproval(id, status);
      setPending((p) => p.filter((u) => u.id !== id));
    } catch (e: any) {
      Alert.alert("Couldn't update", e?.message ?? "Try again");
    } finally {
      setActing(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Waitlist</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.red} />
          </View>
        )}

        {!loading && allowed === false && (
          <View style={styles.card}>
            <Text style={type.subtitle}>Not authorized.</Text>
          </View>
        )}

        {!loading && allowed && pending.length === 0 && (
          <View style={styles.card}>
            <Text style={type.subtitle}>All caught up.</Text>
            <Text style={[type.small, { marginTop: 6 }]}>No one's waiting for approval.</Text>
          </View>
        )}

        {!loading &&
          allowed &&
          pending.map((u) => (
            <View key={u.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {u.display_name || u.email || "New user"}
                </Text>
                {u.email && (
                  <Text style={styles.sub} numberOfLines={1}>{u.email}</Text>
                )}
              </View>
              <Pressable
                onPress={() => act(u.id, "approved")}
                disabled={acting === u.id}
                style={styles.approve}
              >
                <Text style={styles.approveText}>{acting === u.id ? "…" : "Approve"}</Text>
              </Pressable>
              <Pressable
                onPress={() => act(u.id, "rejected")}
                disabled={acting === u.id}
                hitSlop={6}
              >
                <Text style={styles.reject}>Deny</Text>
              </Pressable>
            </View>
          ))}
      </ScrollView>
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
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.faint,
  },
  closeText: { fontSize: 18, fontWeight: "700", color: colors.ink },
  body: { padding: spacing.lg, paddingBottom: 80 },
  center: { padding: 60, alignItems: "center" },
  card: {
    padding: spacing.lg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    marginBottom: 10,
  },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink },
  sub: { ...type.small, marginTop: 2 },
  approve: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.red,
  },
  approveText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  reject: { color: colors.mute, fontSize: 14, fontWeight: "700" },
});
