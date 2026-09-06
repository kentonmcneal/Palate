import { useCallback, useState } from "react";
import { View, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect, Stack } from "expo-router";
import { colors, spacing, type } from "../theme";
import { Avatar } from "../components/Avatar";
import { Spacer } from "../components/Button";
import {
  listFollowers, listFollowing, listFriends,
  followUser, unfollowUser, followStateOf, followLabel,
  type FollowListItem,
} from "../lib/friends";

// ============================================================================
// follows.tsx — followers, following, friends.
// ----------------------------------------------------------------------------
// This screen used to be "Friends", with a Requests tab where two invitations
// sat unanswered for weeks. There is nothing to answer any more, so the three
// tabs are just three readings of the same graph:
//
//   Followers — people who see your visits
//   Following — people whose visits you see
//   Friends   — both at once
//
// Anyone's list is readable (`user` param), the way it is on Instagram; the
// follow button on each row is about YOUR relationship to that person, which
// is why it can appear inside someone else's follower list.
// ============================================================================

type Tab = "followers" | "following" | "friends";
const TABS: { key: Tab; label: string }[] = [
  { key: "followers", label: "Followers" },
  { key: "following", label: "Following" },
  { key: "friends", label: "Friends" },
];

export default function FollowsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: Tab; user?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab ?? "followers");
  const [rows, setRows] = useState<FollowListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const fn = tab === "followers" ? listFollowers : tab === "following" ? listFollowing : listFriends;
      setRows(await fn());
      setError(null);
    } catch (e: any) {
      // A list that fails is a list that says so. Seven screens in this app
      // used to swallow this into an empty state that read as "nobody yet".
      setError(e?.message ?? "Couldn't load this list.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  useFocusEffect(useCallback(() => { setLoading(true); void load(); }, [load]));

  async function toggle(item: FollowListItem) {
    const id = item.friend.id;
    setBusy(id);
    try {
      if (item.youFollow) await unfollowUser(id);
      else await followUser(id);
      await load();
    } catch { /* the row simply stays as it was */ }
    finally { setBusy(null); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ title: "People you follow" }} />
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}>
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.mute} />}
      >
        {loading && <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.mute} />}

        {!loading && error && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Couldn't load this list</Text>
            <Text style={styles.emptyBody}>{error}</Text>
            <Spacer />
            <Pressable onPress={() => { setLoading(true); void load(); }}><Text style={styles.link}>Try again</Text></Pressable>
          </View>
        )}

        {!loading && !error && rows.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {tab === "followers" ? "Nobody follows you yet"
                : tab === "following" ? "You're not following anyone"
                : "No friends yet"}
            </Text>
            <Text style={styles.emptyBody}>
              {tab === "friends"
                ? "A friend is someone you follow who follows you back."
                : "Find people in People — no request, no waiting."}
            </Text>
            <Spacer />
            <Pressable onPress={() => router.push("/people" as never)}>
              <Text style={styles.link}>Browse people →</Text>
            </Pressable>
          </View>
        )}

        {!loading && !error && rows.map((item) => {
          const state = followStateOf(item);
          return (
            <Pressable
              key={item.friend.id}
              style={styles.row}
              onPress={() => router.push(`/profile/${item.friend.id}` as never)}
              accessibilityRole="button"
            >
              <Avatar uri={item.friend.avatar_url} name={item.friend.display_name} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.friend.display_name || (item.friend.username ? `@${item.friend.username}` : "Someone")}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {state === "mutual" ? "Friends"
                    : state === "follows_you" ? "Follows you"
                    : item.friend.username ? `@${item.friend.username}` : " "}
                </Text>
              </View>
              <Pressable
                onPress={() => void toggle(item)}
                disabled={busy === item.friend.id}
                style={[styles.followBtn, item.youFollow && styles.followBtnGhost]}
                hitSlop={6}
              >
                <Text style={[styles.followBtnText, item.youFollow && styles.followBtnGhostText]}>
                  {busy === item.friend.id ? "…" : followLabel(state)}
                </Text>
              </Pressable>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  tabs: { flexDirection: "row", gap: 6, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  tabBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.faint },
  tabBtnActive: { backgroundColor: colors.ink },
  tabLabel: { fontSize: 13, fontWeight: "700", color: colors.mute },
  tabLabelActive: { color: "#fff" },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  rowName: { fontSize: 15, fontWeight: "700", color: colors.ink },
  rowMeta: { fontSize: 12, fontWeight: "500", color: colors.mute, marginTop: 1 },
  followBtn: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.ink },
  followBtnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.line },
  followBtnText: { fontSize: 12, fontWeight: "800", color: "#fff" },
  followBtnGhostText: { color: colors.ink },
  empty: { paddingTop: spacing.xxl, alignItems: "center" },
  emptyTitle: { ...type.subtitle, color: colors.ink },
  emptyBody: { ...type.small, marginTop: 6, textAlign: "center" },
  link: { fontSize: 14, fontWeight: "700", color: colors.red },
});
