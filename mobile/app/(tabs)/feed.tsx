import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  Pressable, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Spacer } from "../../components/Button";
import { Avatar } from "../../components/Avatar";
import { colors, spacing, type } from "../../theme";
import { listFeed, toggleLike, type FeedEvent } from "../../lib/feed";
import { listIncomingRequests } from "../../lib/friends";

export default function FeedTab() {
  const router = useRouter();
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [feed, requests] = await Promise.all([
        listFeed(60),
        listIncomingRequests(),
      ]);
      setEvents(feed);
      setPendingCount(requests.length);
    } catch (e: any) {
      console.warn("feed load", e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
  }, [load]));

  async function handleLike(ev: FeedEvent) {
    // Optimistic update
    setEvents((curr) =>
      curr.map((e) =>
        e.id === ev.id
          ? { ...e, iLiked: !e.iLiked, likeCount: e.likeCount + (e.iLiked ? -1 : 1) }
          : e,
      ),
    );
    try {
      await toggleLike(ev.id, ev.iLiked);
    } catch (e: any) {
      // Revert on failure
      setEvents((curr) =>
        curr.map((x) =>
          x.id === ev.id
            ? { ...x, iLiked: ev.iLiked, likeCount: ev.likeCount }
            : x,
        ),
      );
      Alert.alert("Couldn't update like", e?.message ?? "Try again");
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
          />
        }
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={type.title}>Feed</Text>
            <Text style={[type.body, { color: colors.mute, marginTop: 4 }]}>
              How your friends actually eat.
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Pressable onPress={() => router.push({ pathname: "/friends", params: { tab: "leaderboard" } })} style={styles.friendsBtn}>
              <Text style={styles.friendsBtnText}>Board</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/friends")} style={styles.friendsBtn}>
              <Text style={styles.friendsBtnText}>
                Friends{pendingCount > 0 ? ` · ${pendingCount}` : ""}
              </Text>
            </Pressable>
          </View>
        </View>
        <Spacer size={20} />

        {loading && events.length === 0 && (
          <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
        )}

        {!loading && events.length === 0 && (
          <View style={styles.empty}>
            <Text style={type.subtitle}>Your feed is quiet right now.</Text>
            <Text style={[type.small, { marginTop: 8, lineHeight: 20 }]}>
              When your friends share their weekly Wrapped or hit a milestone,
              it'll show up here. Add some friends to get started.
            </Text>
            <Spacer />
            <Pressable
              onPress={() => router.push("/friends")}
              style={styles.emptyCta}
            >
              <Text style={styles.emptyCtaText}>Find friends →</Text>
            </Pressable>
          </View>
        )}

        {events.map((ev) => (
          <FeedRow key={ev.id} event={ev} onLike={() => handleLike(ev)} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function FeedRow({ event, onLike }: { event: FeedEvent; onLike: () => void }) {
  const router = useRouter();
  const name = event.user?.display_name || (event.user?.email ? event.user.email.split("@")[0] : "Someone");
  const when = relativeTime(event.created_at);

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.row}
        onPress={() => event.user_id && router.push(`/profile/${event.user_id}`)}
      >
        <Avatar uri={event.user?.avatar_url} name={event.user?.display_name} email={event.user?.email} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.when}>{when}</Text>
        </View>
      </Pressable>

      <FeedBody event={event} />

      <View style={styles.actions}>
        <Pressable onPress={onLike} style={styles.likeBtn} accessibilityRole="button">
          <Text style={[styles.likeText, event.iLiked && styles.likeTextActive]}>
            {event.iLiked ? "♥" : "♡"} {event.likeCount > 0 ? event.likeCount : ""}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function FeedBody({ event }: { event: FeedEvent }) {
  if (event.kind === "wrapped_shared") {
    const p = event.payload as { persona_label: string; tagline: string; total_visits: number; top_restaurant: string | null };
    return (
      <View style={styles.wrappedCard}>
        <Text style={styles.wrappedEyebrow}>WEEKLY WRAPPED</Text>
        <Text style={styles.wrappedPersona}>{p.persona_label}</Text>
        <Text style={styles.wrappedTagline}>"{p.tagline}"</Text>
        <View style={styles.wrappedStats}>
          <View style={styles.wrappedStat}>
            <Text style={styles.wrappedStatV}>{p.total_visits}</Text>
            <Text style={styles.wrappedStatL}>visits</Text>
          </View>
          {p.top_restaurant && (
            <View style={[styles.wrappedStat, { flex: 1.5 }]}>
              <Text style={styles.wrappedStatV} numberOfLines={1}>{p.top_restaurant}</Text>
              <Text style={styles.wrappedStatL}>top spot</Text>
            </View>
          )}
        </View>
      </View>
    );
  }
  if (event.kind === "persona_change") {
    const p = event.payload as { from_persona: string | null; to_persona: string };
    return (
      <Text style={styles.bodyText}>
        Just became <Text style={styles.bodyAccent}>{p.to_persona}</Text>
        {p.from_persona ? ` (was ${p.from_persona} last week)` : ""}.
      </Text>
    );
  }
  if (event.kind === "milestone") {
    const p = event.payload as { streak_days: number };
    return (
      <Text style={styles.bodyText}>
        Hit a <Text style={styles.bodyAccent}>{p.streak_days}-day streak 🔥</Text>
      </Text>
    );
  }
  if (event.kind === "visit_logged") {
    const p = event.payload as { restaurant_name: string; cuisine: string | null; neighborhood: string | null };
    const cuisineLine = p.cuisine
      ? `${cuisineArticle(p.cuisine)} ${prettyCuisine(p.cuisine)} spot`
      : "a restaurant";
    return (
      <Text style={styles.bodyText}>
        Logged <Text style={styles.bodyAccent}>{cuisineLine}</Text>{p.neighborhood ? ` in ${p.neighborhood}` : ""}
        {" — "}<Text style={{ color: colors.mute, fontStyle: "italic" }}>{p.restaurant_name}</Text>
      </Text>
    );
  }
  return null;
}

function prettyCuisine(c: string): string {
  return c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function cuisineArticle(c: string): string {
  return /^[aeiou]/i.test(c) ? "an" : "a";
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { padding: spacing.lg, paddingBottom: 100 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  friendsBtn: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  friendsBtnText: { fontSize: 13, fontWeight: "700", color: colors.ink },
  center: { padding: 60, alignItems: "center" },
  empty: {
    padding: spacing.lg, borderRadius: 18,
    borderWidth: 1, borderColor: colors.line,
  },
  emptyCta: {
    alignSelf: "flex-start",
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 999, backgroundColor: colors.red,
  },
  emptyCtaText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  card: {
    marginBottom: 14,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.line,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.red,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink },
  when: { ...type.small, marginTop: 2 },

  bodyText: { marginTop: 12, fontSize: 16, color: colors.ink, lineHeight: 22 },
  bodyAccent: { color: colors.red, fontWeight: "700" },

  wrappedCard: {
    marginTop: 12,
    padding: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.ink,
  },
  wrappedEyebrow: { color: "rgba(255,255,255,0.6)", fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },
  wrappedPersona: { color: colors.red, fontSize: 22, fontWeight: "800", letterSpacing: -0.5, marginTop: 4 },
  wrappedTagline: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontStyle: "italic", marginTop: 2 },
  wrappedStats: { flexDirection: "row", gap: 10, marginTop: 14 },
  wrappedStat: {
    flex: 1, padding: 10, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },
  wrappedStatV: { color: "#fff", fontSize: 16, fontWeight: "800" },
  wrappedStatL: { color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: "600", marginTop: 2 },

  actions: { marginTop: 12, flexDirection: "row" },
  likeBtn: { paddingVertical: 6, paddingHorizontal: 4 },
  likeText: { fontSize: 16, color: colors.mute, fontWeight: "700" },
  likeTextActive: { color: colors.red },
});
