import { useCallback, useLayoutEffect, useRef, useState } from "react";
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
import { FriendsInCities } from "../components/FriendsInCities";

type Tab = "followers" | "following" | "friends";
const TABS: { key: Tab; label: string }[] = [
  { key: "followers", label: "Followers" },
  { key: "following", label: "Following" },
  { key: "friends", label: "Friends" },
];
const safeTab = (value: unknown): Tab =>
  value === "following" || value === "friends" ? value : "followers";

export default function FollowsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string | string[]; user?: string | string[] }>();
  // Keep mutation ownership in this mounted screen, even while an unsupported
  // target route temporarily hides the caller's list.
  const supported = params.user === undefined;
  const initialTab = safeTab(params.tab);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [routeTab, setRouteTab] = useState(initialTab);
  if (routeTab !== initialTab) {
    setRouteTab(initialTab);
    setTab(initialTab);
  }
  const [rows, setRows] = useState<FollowListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationErrors, setMutationErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string[]>([]);
  const epoch = useRef(0);
  const request = useRef(0);
  const active = useRef<{ tab: Tab; session: number } | null>(null);
  const pending = useRef(new Set<string>());
  // Successful actions stay gated until a fresh list reconciles them, so a
  // second tap cannot act on the old youFollow value while reload is pending.
  const gates = useRef(new Set<string>());

  // Invalidate before passive focus effects: an old result or captured button
  // cannot publish/start work during the commit of a new route/tab.
  useLayoutEffect(() => {
    active.current = null;
    ++request.current;
  }, [supported, tab]);

  const load = useCallback(async (refresh = false) => {
    const view = active.current;
    if (!view) return;
    const sequence = ++request.current;
    setRefreshing(refresh);
    if (pending.current.size > 0) return; // last mutation settles into current tab
    setLoading(true);
    const current = () => active.current === view && request.current === sequence;
    try {
      const fn = view.tab === "followers" ? listFollowers : view.tab === "following" ? listFollowing : listFriends;
      const next = await fn();
      if (!current()) return;
      setRows(next);
      setError(null);
      gates.current.clear();
      setBusy([]);
    } catch {
      if (current()) setError("Please try again. Your connections could not be loaded.");
    } finally {
      if (current()) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    if (!supported) return;
    const view = { tab, session: ++epoch.current };
    active.current = view;
    setRows([]);
    setError(null);
    setMutationErrors({});
    setLoading(true);
    setBusy([...gates.current]);
    void load();
    return () => {
      if (active.current === view) active.current = null;
      ++request.current;
    };
  }, [supported, tab, load]));

  async function toggle(item: FollowListItem) {
    const view = active.current;
    const id = item.friend.id;
    if (!view || gates.current.has(id)) return;
    gates.current.add(id); // synchronous: repeated taps in one render are gated
    pending.current.add(id);
    ++request.current; // a pre-mutation snapshot must never overwrite its result
    setBusy([...gates.current]);
    setMutationErrors((errors) => { const next = { ...errors }; delete next[id]; return next; });
    try {
      if (item.youFollow) await unfollowUser(id);
      else await followUser(id);
    } catch {
      if (active.current === view) {
        const name = item.friend.display_name || (item.friend.username ? `@${item.friend.username}` : "this person");
        setMutationErrors((errors) => ({ ...errors, [id]: `Couldn't ${item.youFollow ? "unfollow" : "follow"} ${name}. Please try again.` }));
      }
    } finally {
      pending.current.delete(id);
      if (active.current) {
        setBusy([...gates.current]);
        // Reconcile the CURRENT tab, not the one captured when the tap began.
        // Errors also reload: a failed reply may have followed a committed write.
        if (pending.current.size === 0) void load();
      }
    }
  }

  if (!supported) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <Stack.Screen options={{ title: "Connections unavailable" }} />
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>This connection list isn&apos;t available</Text>
          <Text style={styles.emptyBody}>Profile-specific connection lists aren&apos;t supported. You can open your own connections instead.</Text>
          <Spacer />
          <Pressable accessibilityRole="button" accessibilityLabel="Open my connections" onPress={() => router.replace("/follows?tab=friends" as never)}>
            <Text style={styles.link}>Open my connections →</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ title: "Your connections" }} />
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Pressable key={t.key} accessibilityRole="tab" accessibilityLabel={t.label} accessibilityState={{ selected: tab === t.key }} onPress={() => setTab(t.key)} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}>
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.mute} />}>
        {Object.entries(mutationErrors).map(([id, message]) => <Text key={id} accessibilityRole="alert" style={styles.emptyBody}>{message}</Text>)}
        {!loading && !error && tab === "friends" && <FriendsInCities />}
        {loading && <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.mute} />}
        {!loading && error && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Couldn&apos;t load this list</Text>
            <Text style={styles.emptyBody}>{error}</Text>
            <Spacer />
            <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={() => void load()}><Text style={styles.link}>Try again</Text></Pressable>
          </View>
        )}
        {!loading && !error && rows.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{tab === "followers" ? "Nobody follows you yet" : tab === "following" ? "You're not following anyone" : "No friends yet"}</Text>
            <Text style={styles.emptyBody}>{tab === "friends" ? "A friend is someone you follow who follows you back." : "Find people in People. No request, no waiting."}</Text>
            <Spacer />
            <Pressable accessibilityRole="button" onPress={() => router.push("/people" as never)}><Text style={styles.link}>Browse people →</Text></Pressable>
          </View>
        )}
        {!loading && !error && rows.map((item) => {
          const state = followStateOf(item);
          const name = item.friend.display_name || (item.friend.username ? `@${item.friend.username}` : "Someone");
          const waiting = busy.includes(item.friend.id);
          return (
            <View key={item.friend.id} style={styles.row}>
              <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }} onPress={() => router.push(`/profile/${item.friend.id}` as never)} accessibilityRole="button" accessibilityLabel={`Open ${name}'s profile`}>
                <Avatar uri={item.friend.avatar_url} name={item.friend.display_name} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>{state === "mutual" ? "Friends" : state === "follows_you" ? "Follows you" : item.friend.username ? `@${item.friend.username}` : " "}</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => void toggle(item)} disabled={waiting} accessibilityRole="button" accessibilityLabel={`${item.youFollow ? "Unfollow" : "Follow"} ${name}`} accessibilityState={{ disabled: waiting, busy: waiting }} style={[styles.followBtn, item.youFollow && styles.followBtnGhost]} hitSlop={6}>
                <Text style={[styles.followBtnText, item.youFollow && styles.followBtnGhostText]}>{waiting ? "…" : followLabel(state)}</Text>
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
