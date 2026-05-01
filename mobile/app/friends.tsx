import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  Pressable, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Spacer } from "../components/Button";
import { Avatar } from "../components/Avatar";
import { colors, spacing, type } from "../theme";
import {
  listFriends, listIncomingRequests, listOutgoingRequests,
  searchUsers, requestFriendship, acceptFriendship,
  declineFriendship, unfriend, loadFriendsLeaderboard,
  type FriendListItem, type FriendProfile, type LeaderboardEntry,
} from "../lib/friends";

type Tab = "friends" | "leaderboard" | "requests" | "find";

export default function FriendsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab ?? "friends");
  const [friends, setFriends] = useState<FriendListItem[]>([]);
  const [incoming, setIncoming] = useState<FriendListItem[]>([]);
  const [outgoing, setOutgoing] = useState<FriendListItem[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FriendProfile[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    try {
      const [f, i, o, lb] = await Promise.all([
        listFriends(), listIncomingRequests(), listOutgoingRequests(),
        loadFriendsLeaderboard().catch(() => []),
      ]);
      setFriends(f); setIncoming(i); setOutgoing(o); setLeaderboard(lb);
    } catch (e: any) {
      console.warn("friends load", e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
  }, [load]));

  async function handleSearch() {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await searchUsers(q);
      // Filter out users I already have any relationship with
      const known = new Set([
        ...friends.map((f) => f.friend.id),
        ...incoming.map((f) => f.friend.id),
        ...outgoing.map((f) => f.friend.id),
      ]);
      setSearchResults(results.filter((r) => !known.has(r.id)));
    } catch (e: any) {
      Alert.alert("Search failed", e.message ?? "Try again");
    } finally {
      setSearching(false);
    }
  }

  async function handleRequest(target: FriendProfile) {
    try {
      await requestFriendship(target.id);
      setSearchResults((curr) => curr.filter((r) => r.id !== target.id));
      await load();
    } catch (e: any) {
      Alert.alert("Couldn't send request", e.message ?? "Try again");
    }
  }

  async function handleAccept(item: FriendListItem) {
    try {
      await acceptFriendship(item.friend.id);
      setIncoming((curr) => curr.filter((x) => x.friendship.id !== item.friendship.id));
      await load();
    } catch (e: any) {
      Alert.alert("Couldn't accept", e.message ?? "Try again");
    }
  }

  async function handleDecline(item: FriendListItem) {
    try {
      await declineFriendship(item.friend.id);
      setIncoming((curr) => curr.filter((x) => x.friendship.id !== item.friendship.id));
    } catch (e: any) {
      Alert.alert("Couldn't decline", e.message ?? "Try again");
    }
  }

  function handleUnfriend(item: FriendListItem) {
    Alert.alert(
      "Remove friend?",
      item.friend.display_name || item.friend.email || "this friend",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove", style: "destructive",
          onPress: async () => {
            try {
              await unfriend(item.friend.id);
              setFriends((curr) => curr.filter((f) => f.friendship.id !== item.friendship.id));
            } catch (e: any) {
              Alert.alert("Couldn't remove", e.message ?? "Try again");
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <Text style={type.title}>Friends</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TabButton label="Friends" count={friends.length} active={tab === "friends"} onPress={() => setTab("friends")} />
        <TabButton label="Board" active={tab === "leaderboard"} onPress={() => setTab("leaderboard")} />
        <TabButton label="Requests" count={incoming.length} active={tab === "requests"} onPress={() => setTab("requests")} accent />
        <TabButton label="Find" active={tab === "find"} onPress={() => setTab("find")} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {loading && (
          <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
        )}

        {/* FRIENDS TAB */}
        {!loading && tab === "friends" && (
          friends.length === 0 ? (
            <View style={styles.empty}>
              <Text style={type.subtitle}>No friends yet.</Text>
              <Text style={[type.small, { marginTop: 6 }]}>
                Use the Find tab to search by email, or send invites from your Profile tab.
              </Text>
            </View>
          ) : (
            friends.map((item) => (
              <FriendRow
                key={item.friendship.id}
                friend={item.friend}
                actions={[{ label: "Remove", style: "ghost", onPress: () => handleUnfriend(item) }]}
              />
            ))
          )
        )}

        {/* LEADERBOARD TAB */}
        {!loading && tab === "leaderboard" && (
          leaderboard.length === 0 ? (
            <View style={styles.empty}>
              <Text style={type.subtitle}>No board yet.</Text>
              <Text style={[type.small, { marginTop: 6 }]}>
                Once you add a few friends, you'll see who's eating where this week.
              </Text>
            </View>
          ) : (
            <View>
              <Text style={[type.small, { marginBottom: 10 }]}>
                Sorted by visits this week. Tap a row to see their full profile.
              </Text>
              {leaderboard.map((row, i) => (
                <Pressable
                  key={row.user_id}
                  onPress={() => router.push(`/profile/${row.user_id}`)}
                  style={styles.lbRow}
                >
                  <Text style={styles.lbRank}>{i + 1}</Text>
                  <Avatar uri={row.avatar_url} name={row.display_name} email={row.email} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lbName} numberOfLines={1}>
                      {row.display_name || (row.email ? row.email.split("@")[0] : "Friend")}
                    </Text>
                    {row.persona_label && (
                      <Text style={styles.lbPersona} numberOfLines={1}>{row.persona_label}</Text>
                    )}
                  </View>
                  <View style={styles.lbStats}>
                    <Text style={styles.lbStatBig}>{row.visits_this_week}</Text>
                    <Text style={styles.lbStatLabel}>this wk</Text>
                  </View>
                  <View style={styles.lbStats}>
                    <Text style={styles.lbStatBig}>{row.unique_cuisines}</Text>
                    <Text style={styles.lbStatLabel}>cuisines</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )
        )}

        {/* REQUESTS TAB */}
        {!loading && tab === "requests" && (
          <>
            <Section title="They want to be friends">
              {incoming.length === 0 ? (
                <Text style={[type.small, { lineHeight: 20 }]}>No pending requests.</Text>
              ) : (
                incoming.map((item) => (
                  <FriendRow
                    key={item.friendship.id}
                    friend={item.friend}
                    actions={[
                      { label: "Accept", style: "primary", onPress: () => handleAccept(item) },
                      { label: "Decline", style: "ghost", onPress: () => handleDecline(item) },
                    ]}
                  />
                ))
              )}
            </Section>

            {outgoing.length > 0 && (
              <Section title="You sent">
                {outgoing.map((item) => (
                  <FriendRow
                    key={item.friendship.id}
                    friend={item.friend}
                    sublabel="Pending"
                  />
                ))}
              </Section>
            )}
          </>
        )}

        {/* FIND TAB */}
        {!loading && tab === "find" && (
          <View>
            <Text style={[type.small, { marginBottom: 8, lineHeight: 20 }]}>
              Search by username, email, or display name. Need at least 2 characters.
            </Text>
            <View style={styles.searchRow}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="@username, email, or name…"
                placeholderTextColor={colors.mute}
                style={styles.searchInput}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={handleSearch}
              />
              <Pressable onPress={handleSearch} style={styles.searchBtn}>
                <Text style={styles.searchBtnText}>{searching ? "…" : "Search"}</Text>
              </Pressable>
            </View>
            <Spacer />
            {searchResults.length === 0 && query.trim().length >= 2 && !searching && (
              <Text style={[type.small, { textAlign: "center", marginTop: 16 }]}>
                No matches. Make sure they've signed up — and try the full email.
              </Text>
            )}
            {searchResults.map((p) => (
              <FriendRow
                key={p.id}
                friend={p}
                actions={[{ label: "Add friend", style: "primary", onPress: () => handleRequest(p) }]}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------- Sub-components ----------------

function TabButton({
  label, count, active, onPress, accent,
}: { label: string; count?: number; active: boolean; onPress: () => void; accent?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
        {label}
        {count !== undefined && count > 0 && (
          <Text style={[styles.tabCount, accent && { color: active ? "#fff" : colors.red }]}>
            {" "}{count}
          </Text>
        )}
      </Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.xl }}>
      <Text style={[type.micro, { marginBottom: 10 }]}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

type Action = { label: string; style: "primary" | "ghost"; onPress: () => void };

function FriendRow({
  friend, actions = [], sublabel,
}: { friend: FriendProfile; actions?: Action[]; sublabel?: string }) {
  const router = useRouter();
  const name = friend.display_name || (friend.email ? friend.email.split("@")[0] : "Unknown");
  const subtext = sublabel ?? friend.email ?? "";

  return (
    <Pressable
      style={styles.friendRow}
      onPress={() => router.push(`/profile/${friend.id}`)}
    >
      <Avatar uri={friend.avatar_url} name={friend.display_name} email={friend.email} size={44} />
      <View style={{ flex: 1 }}>
        <Text style={styles.friendName} numberOfLines={1}>{name}</Text>
        {subtext ? (
          <Text style={[type.small, { marginTop: 2 }]} numberOfLines={1}>
            {subtext}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {actions.map((a) => (
          <Pressable
            key={a.label}
            onPress={(e) => { e.stopPropagation(); a.onPress(); }}
            style={a.style === "primary" ? styles.btnPrimary : styles.btnGhost}
          >
            <Text style={a.style === "primary" ? styles.btnPrimaryText : styles.btnGhostText}>
              {a.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Pressable>
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
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.faint,
  },
  closeText: { fontSize: 16, fontWeight: "700", color: colors.ink },

  tabs: {
    flexDirection: "row", gap: 6,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.line, borderBottomWidth: 1,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.faint,
    alignItems: "center",
  },
  tabBtnActive: { backgroundColor: colors.ink },
  tabLabel: { fontSize: 13, fontWeight: "700", color: colors.mute },
  tabLabelActive: { color: "#fff" },
  tabCount: { fontWeight: "800" },

  body: { padding: spacing.lg, paddingBottom: 80 },
  center: { padding: 60, alignItems: "center" },
  empty: { padding: spacing.lg, borderRadius: 18, borderWidth: 1, borderColor: colors.line },

  friendRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 14,
    borderBottomColor: colors.line, borderBottomWidth: 1,
    gap: 12,
  },
  friendAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.red,
    alignItems: "center", justifyContent: "center",
  },
  friendAvatarText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  friendName: { fontSize: 15, fontWeight: "700", color: colors.ink },

  btnPrimary: {
    paddingHorizontal: 14, height: 36, borderRadius: 18,
    backgroundColor: colors.red,
    alignItems: "center", justifyContent: "center",
  },
  btnPrimaryText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  btnGhost: {
    paddingHorizontal: 14, height: 36, borderRadius: 18,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
    alignItems: "center", justifyContent: "center",
  },
  btnGhostText: { color: colors.mute, fontSize: 13, fontWeight: "700" },

  searchRow: { flexDirection: "row", gap: 10 },
  searchInput: {
    flex: 1, height: 48, borderRadius: 14,
    borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 16, fontSize: 16, color: colors.ink,
  },
  searchBtn: {
    paddingHorizontal: 18,
    backgroundColor: colors.red,
    borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  searchBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },

  lbRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12, paddingHorizontal: 4,
    borderBottomColor: colors.line, borderBottomWidth: 1,
    gap: 12,
  },
  lbRank: { width: 18, fontSize: 14, fontWeight: "800", color: colors.mute },
  lbName: { fontSize: 15, fontWeight: "700", color: colors.ink },
  lbPersona: { fontSize: 12, color: colors.red, fontWeight: "600", marginTop: 2 },
  lbStats: { alignItems: "center", minWidth: 50 },
  lbStatBig: { fontSize: 16, fontWeight: "800", color: colors.ink },
  lbStatLabel: { fontSize: 10, fontWeight: "600", color: colors.mute, marginTop: 1, letterSpacing: 0.4 },
});
