import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { View, StyleSheet, Pressable, FlatList } from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { track } from "../lib/analytics";
import { getInboxReadResult, confirmParamsFor, type InboxEntry } from "../lib/passive-confirm";

import { accountWriteSession, isAccountWriteSession, type AccountWriteSession } from "../lib/account-write";
import { onPersonalSignalInvalidate } from "../lib/personal-signal";

// Visits detected during quiet hours or over the daily notification cap land
// here. The strict reader applies the shared inbox expiry policy.
export default function PassiveInbox() {
  // RootLayout advances the account clock before invalidating personal signals.
  // Same-account invalidations leave this snapshot unchanged.
  const account = useSyncExternalStore(onPersonalSignalInvalidate, accountWriteSession, accountWriteSession);
  return <InboxSession key={account.generation} account={account} />;
}

function InboxSession({ account }: { account: AccountWriteSession }) {
  const router = useRouter();
  const [entries, setEntries] = useState<InboxEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const life = useRef<object | null>(null);
  const request = useRef<object | null>(null);
  const focused = useRef(false);
  const verified = useRef<InboxEntry[] | null>(null);
  useLayoutEffect(() => {
    life.current = {};
    return () => { life.current = null; request.current = null; verified.current = null; };
  }, []);

  const load = useCallback(async () => {
    const owner = life.current;
    if (!owner || !focused.current || request.current || !isAccountWriteSession(account)) return;
    const ticket = {};
    request.current = ticket;
    verified.current = null;
    setStatus("loading");
    const current = () => life.current === owner && focused.current && request.current === ticket && isAccountWriteSession(account);
    try {
      const result = await getInboxReadResult();
      if (!current()) return;
      if (result.status === "ready") {
        verified.current = result.entries;
        setEntries(result.entries);
        setStatus("ready");
      } else setStatus("unavailable");
    } catch {
      // Defensive against an unexpected rejection at the display boundary.
      if (current()) setStatus("unavailable");
    } finally {
      if (current()) request.current = null;
    }
  }, [account]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    void track("inbox_opened");
    void load();
    return () => { focused.current = false; request.current = null; verified.current = null; };
  }, [load]));

  function back() {
    if (!life.current || !focused.current || accountWriteSession() !== account) return;
    life.current = null; request.current = null; verified.current = null;
    router.back();
  }
  function openEntry(entry: InboxEntry) {
    if (!life.current || !isAccountWriteSession(account) || !verified.current?.includes(entry)) return;
    // Invalidate retained row callbacks before navigation/focus cleanup.
    verified.current = null;
    router.push({
      pathname: entry.cluster ? "/confirm-multi" : "/confirm-visit",
      params: confirmParamsFor(entry),
    });
  }
  const signedOut = account.accountId === null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={back} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Recent visits</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={entries}
        refreshing={!signedOut && status === "loading"}
        onRefresh={load}
        ListHeaderComponent={
          signedOut ? <View style={styles.card}><Text style={type.subtitle}>Recent visits unavailable.</Text><Text style={type.small}>Return when your account is ready.</Text></View> :
          status === "unavailable" ? <View style={styles.card}>
            <Text style={type.subtitle}>Couldn’t load recent visits.</Text>
            <Text style={[type.small, { marginTop: 6 }]}>{entries.length ? "Previously loaded visits are shown below. Retry to check which still need confirmation." : "We couldn’t check which visits need confirmation. Try again."}</Text>
            <Pressable accessibilityRole="button" onPress={load} style={styles.retry}><Text style={styles.cta}>Try again</Text></Pressable>
          </View> : status === "loading" ? <View style={styles.card}><Text style={type.small}>{entries.length ? "Checking recent visits…" : "Loading recent visits…"}</Text></View> : null
        }
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.body}
        ListEmptyComponent={
          !signedOut && status === "ready" ? <View style={styles.card}>
            <Text style={type.subtitle}>Nothing to confirm.</Text>
            <Text style={[type.small, { marginTop: 6 }]}>
              Detected visits waiting on you show up here.
            </Text>
          </View> : null
        }
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" disabled={status !== "ready" || signedOut} onPress={() => openEntry(item)} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {new Date(item.detectedAt).toLocaleString()} · {Math.round(item.dwellMin)} min
              </Text>
            </View>
            <Text style={styles.cta}>{status === "ready" ? "Confirm" : "Waiting to refresh"}</Text>
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
  retry: { minHeight: 44, justifyContent: "center", marginTop: 8 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 14,
    borderRadius: 14, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.paper, marginBottom: 10,
  },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink },
  sub: { ...type.small, marginTop: 2 },
  cta: { color: colors.red, fontWeight: "800", fontSize: 14 },
});
