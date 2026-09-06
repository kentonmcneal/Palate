import { useCallback, useState } from "react";
import { View, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect, Stack } from "expo-router";
import { colors, spacing, type } from "../theme";
import { Avatar } from "../components/Avatar";
import { listThreads, type DmThread } from "../lib/messages";

// ============================================================================
// messages — the inbox.
// ----------------------------------------------------------------------------
// Only conversations that have a message in them appear; a thread is created
// by sending, never by opening a profile, so there is no such thing as an
// empty conversation to tidy up.
// ============================================================================

export default function MessagesScreen() {
  const router = useRouter();
  const [threads, setThreads] = useState<DmThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setThreads(await listThreads());
      setError(null);
    } catch (e: any) {
      // A list that fails says so. Seven screens in this app used to swallow
      // this into an empty state that read as "nobody has messaged you".
      setError(e?.message ?? "Couldn't load your messages.");
      setThreads([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ title: "Messages" }} />
      <ScrollView contentContainerStyle={styles.body}>
        {threads === null && <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.mute} />}

        {!!error && <Text style={styles.error}>{error}</Text>}

        {threads?.length === 0 && !error && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyBody}>
              You can message anyone who follows you back. Open their profile and
              tap Message.
            </Text>
            <Pressable onPress={() => router.push("/people" as never)} style={{ marginTop: spacing.md }}>
              <Text style={styles.link}>Browse people →</Text>
            </Pressable>
          </View>
        )}

        {threads?.map((t) => (
          <Pressable
            key={t.thread_id}
            style={styles.row}
            onPress={() => router.push({ pathname: "/thread/[id]", params: { id: t.thread_id, other: t.other_id, name: t.other_name ?? "" } } as never)}
            accessibilityRole="button"
          >
            <Avatar uri={t.other_avatar} name={t.other_name} size={46} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {t.other_name || (t.other_username ? `@${t.other_username}` : "Someone")}
              </Text>
              <Text style={[styles.preview, t.unread > 0 && styles.previewUnread]} numberOfLines={1}>
                {t.last_preview ?? ""}
              </Text>
            </View>
            {t.unread > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{t.unread > 99 ? "99+" : t.unread}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink },
  preview: { fontSize: 13, color: colors.mute, marginTop: 2 },
  previewUnread: { color: colors.ink, fontWeight: "600" },
  badge: {
    minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6,
    backgroundColor: colors.red, alignItems: "center", justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  empty: { paddingTop: spacing.xxl, alignItems: "center" },
  emptyTitle: { ...type.subtitle, color: colors.ink },
  emptyBody: { ...type.small, marginTop: 6, textAlign: "center", lineHeight: 20 },
  link: { fontSize: 14, fontWeight: "700", color: colors.red },
  error: { ...type.small, color: colors.redText, marginTop: spacing.lg },
});
