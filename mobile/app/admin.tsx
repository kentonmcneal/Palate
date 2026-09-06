import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
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
import { observabilityStatus, sendTestEvent } from "../lib/observability";
import { listFeedback, markFeedbackTriaged, type FeedbackRow } from "../lib/feedback-admin";
import { loadRecFunnel, summarize, type RecFunnelRow } from "../lib/rec-funnel";

export default function AdminWaitlistScreen() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  // The server push switch. Lives here because it is the one action in the
  // app that starts messaging other people, and that belongs to a person with
  // is_admin, on a screen nobody else can open.
  const [serverPush, setServerPush] = useState<boolean | null>(null);
  const [flipping, setFlipping] = useState(false);
  // Tester reports. The push is the fast route and it can fail — no token, a
  // revoked permission, Expo down. This is the route that cannot.
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [funnel, setFunnel] = useState<RecFunnelRow[] | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const admin = await isAdmin();
      setAllowed(admin);
      if (admin) {
        setPending(await listPendingUsers());
        setFeedback(await listFeedback(50).catch(() => []));
        setFunnel(await loadRecFunnel(28).catch(() => null));
        const { data } = await supabase
          .from("feature_flags").select("enabled").eq("key", "server_push").maybeSingle();
        setServerPush(Boolean(data?.enabled));
      }
    } catch (e: any) {
      Alert.alert("Couldn't load", e?.message ?? "Try again");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function flipServerPush(next: boolean) {
    setFlipping(true);
    try {
      const { error } = await supabase.rpc("admin_set_feature_flag", {
        p_key: "server_push", p_enabled: next,
      });
      if (error) throw error;
      setServerPush(next);
    } catch (e: any) {
      Alert.alert("Couldn't change that", e?.message ?? "Try again");
    } finally {
      setFlipping(false);
    }
  }

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

        {!loading && allowed && feedback.length > 0 && (
          <View style={styles.card}>
            <Text style={type.subtitle}>
              {feedback.filter((f) => f.status === "new").length > 0
                ? `${feedback.filter((f) => f.status === "new").length} new from testers`
                : "Tester reports"}
            </Text>
            {feedback.slice(0, 12).map((f) => (
              <View key={f.id} style={styles.report}>
                <Text style={styles.reportMeta}>
                  {f.category} · {f.reporter ?? "Someone"}
                  {f.platform ? ` · ${f.platform}` : ""}
                  {f.app_version ? ` · ${f.app_version}` : ""}
                  {f.screenshot_path ? " · 📎" : ""}
                </Text>
                <Text style={styles.reportBody}>{f.message}</Text>
                {f.status === "new" && (
                  <Pressable
                    onPress={async () => {
                      await markFeedbackTriaged(f.id).catch(() => {});
                      void load();
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.reportAction}>Mark read</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Crash reporting, stated rather than assumed. A no-op error reporter
            looks exactly like an app that never errors, which is how a DSN
            sitting in the EAS environment was reported as missing for a day.
            The test button is the only way to know the pipe works without
            waiting for a real crash. */}
        {!loading && allowed && (() => {
          const obs = observabilityStatus();
          return (
            <View style={[styles.card, { marginBottom: 12 }]}>
              <Text style={type.subtitle}>Crash reporting</Text>
              <Text style={[type.small, { marginTop: 6, lineHeight: 20 }]}>
                {obs.hasDsn
                  ? `On, reporting to ${obs.host}. ${obs.initialized ? "Started this session." : "Not started yet this session."}`
                  : "Off. No DSN reached this build, so every error is being swallowed. Check that the build profile names an EAS environment that has EXPO_PUBLIC_SENTRY_DSN."}
              </Text>
              {obs.hasDsn && (
                <Pressable
                  onPress={() => {
                    setTesting(true);
                    void sendTestEvent()
                      .then((sent) => Alert.alert(
                        sent ? "Test event sent" : "Nothing sent",
                        sent
                          ? "It should appear in Sentry within a minute, titled 'Palate test event from the Admin screen'."
                          : "Reporting is not running, so nothing left the device.",
                      ))
                      .finally(() => setTesting(false));
                  }}
                  disabled={testing}
                  style={[styles.approve, { marginTop: 12, alignSelf: "flex-start" }]}
                  accessibilityRole="button"
                >
                  <Text style={styles.approveText}>{testing ? "…" : "Send a test event"}</Text>
                </Pressable>
              )}
            </View>
          );
        })()}

        {!loading && allowed && serverPush !== null && (
          <View style={styles.card}>
            <Text style={type.subtitle}>Server push</Text>
            <Text style={[type.small, { marginTop: 6, lineHeight: 20 }]}>
              {serverPush
                ? "On. Friends' visits, joins, Wrapped and comeback nudges are being sent, inside quiet hours and the daily cap."
                : "Off. Everything queues and expires unsent. Turn this on when you want testers to start hearing from each other."}
            </Text>
            <Pressable
              onPress={() => {
                Alert.alert(
                  serverPush ? "Turn server push off?" : "Turn server push on?",
                  serverPush
                    ? "Queued rows stop sending immediately."
                    : "Every tester with a token starts receiving activity pushes.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: serverPush ? "Turn off" : "Turn on", onPress: () => void flipServerPush(!serverPush) },
                  ],
                );
              }}
              disabled={flipping}
              style={[styles.approve, { marginTop: 12, alignSelf: "flex-start" }]}
            >
              <Text style={styles.approveText}>
                {flipping ? "…" : serverPush ? "Turn off" : "Turn on"}
              </Text>
            </Pressable>
          </View>
        )}

        {!loading && allowed && funnel && (
          <View style={[styles.card, { marginBottom: 12 }]}>
            <Text style={type.subtitle}>Recommendations, last 28 days</Text>
            <Text style={[type.small, { marginTop: 4 }]}>
              Seen is a card at least half on screen for half a second. Taken is a tap, a save or directions. Went is a confirmed visit within seven days of being shown.
            </Text>
            {summarize(funnel).length === 0 && (
              <Text style={[type.small, { marginTop: 10 }]}>Nothing recorded yet. Impressions started on 2026-09-06.</Text>
            )}
            {summarize(funnel).map((row) => (
              <View key={row.surface} style={styles.report}>
                <Text style={styles.reportMeta}>{row.surface.toUpperCase()}</Text>
                <Text style={styles.reportBody}>
                  {row.impressions} seen · {row.taken} taken · {row.visits} went · {row.users} {row.users === 1 ? "person" : "people"}
                </Text>
              </View>
            ))}
            {funnel.some((r) => r.slot === "explore") && (
              <View style={styles.report}>
                <Text style={styles.reportMeta}>SOMETHING DIFFERENT (explore slot)</Text>
                <Text style={styles.reportBody}>
                  {funnel.filter((r) => r.slot === "explore").reduce((n, r) => n + r.impressions, 0)} seen ·{" "}
                  {funnel.filter((r) => r.slot === "explore").reduce((n, r) => n + r.clicks + r.saves + r.maps, 0)} taken ·{" "}
                  {funnel.filter((r) => r.slot === "explore").reduce((n, r) => n + r.visits_7d, 0)} went
                </Text>
              </View>
            )}
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
  report: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  reportMeta: { ...type.micro, fontSize: 10 },
  reportBody: { fontSize: 14, color: colors.ink, marginTop: 5, lineHeight: 20 },
  reportAction: { fontSize: 12, fontWeight: "700", color: colors.red, marginTop: 7 },
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
