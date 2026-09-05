import { useCallback, useMemo, useState } from "react";
import { Image } from "react-native";
import { computeTasteVector } from "../../lib/taste-vector";
import { loadPersonalSignal } from "../../lib/personal-signal";
import { assembleGraph, getCompatibility, type TasteGraph } from "../../lib/recommendation";
import { matchScoreColor, matchScoreTint } from "../../lib/match-score";
import { addToWishlist } from "../../lib/palate-insights";
import { triggerHapticSuccess } from "../../lib/haptics";
import {
  ordinalLabel, youveBeenLabel, mealLine, groupFeedByDay, weekSummary,
} from "../../lib/feed-card";
import { HypeMap } from "../../components/HypeMap";
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Text } from "../../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Spacer } from "../../components/Button";
import { Avatar } from "../../components/Avatar";
import { colors, spacing, type } from "../../theme";
import { listFeed, toggleLike, type FeedEvent } from "../../lib/feed";
import { listIncomingRequests } from "../../lib/friends";
import { loadView } from "../../lib/load-state";
import { LoadError } from "../../components/LoadError";
import { reportContent, blockUser, REPORT_REASONS } from "../../lib/moderation";
import { supabase } from "../../lib/supabase";

export default function FeedTab() {
  const router = useRouter();
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  // Held in state, not swallowed into a console nobody reads.
  const [error, setError] = useState<unknown>(null);
  // "Your match" on every card, scored on the same graph Home and Discover
  // use, so the number beside a friend's visit is the number you would see
  // on the place itself.
  const [graph, setGraph] = useState<TasteGraph | null>(null);

  const load = useCallback(async () => {
    try {
      // The pending-request count is a badge on a button. It must not be able
      // to take the feed down with it: listIncomingRequests answered 400 for
      // its whole life (its embed pointed at auth.users, fixed in 0092), and
      // because it sat in this Promise.all the feed reported that failure as
      // its own. The Friends screen shows that call's errors; this one only
      // needs a number.
      const [feed, requests, { data: auth }] = await Promise.all([
        listFeed(60),
        listIncomingRequests().catch(() => []),
        supabase.auth.getUser(),
      ]);
      setEvents(feed);
      setPendingCount(requests.length);
      setMyId(auth.user?.id ?? null);
      setError(null);
      void Promise.all([
        computeTasteVector().catch(() => null),
        loadPersonalSignal().catch(() => null),
      ]).then(([vector, personal]) => setGraph(assembleGraph(vector, personal)))
        .catch(() => {});
    } catch (e: any) {
      // The feed once returned 400 on every call for its whole existence and
      // rendered as "quiet right now" the entire time. A failure has to look
      // like a failure.
      setError(e ?? new Error("feed load failed"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
  }, [load]));

  const view = loadView({ loading, error, count: events.length });
  const sections = useMemo(() => groupFeedByDay(events), [events]);
  const summary = useMemo(() => weekSummary(events), [events]);

  function removeUser(userId: string) {
    setEvents((curr) => curr.filter((e) => e.user_id !== userId));
  }
  function removeEvent(id: string) {
    setEvents((curr) => curr.filter((e) => e.id !== id));
  }

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
        {/* Title and chips are stacked, not side by side. Four fixed-width
            chips claim their full intrinsic width in a row, which starved the
            flex:1 text column down to a single character per line — the title
            rendered vertically as "F e e d". */}
        <View style={styles.header}>
          <Text style={type.title}>Feed</Text>
          <Text style={[type.body, { color: colors.mute, marginTop: 4 }]}>
            How everyone on Palate actually eats.
          </Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Pressable onPress={() => router.push({ pathname: "/friends", params: { tab: "leaderboard" } })} style={styles.friendsBtn}>
              <Text style={styles.friendsBtnText}>Board</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/group")} style={styles.friendsBtn}>
              <Text style={styles.friendsBtnText}>Eat together</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/people")} style={styles.friendsBtn}>
              <Text style={styles.friendsBtnText}>People</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/friends")} style={styles.friendsBtn}>
              <Text style={styles.friendsBtnText}>
                Friends{pendingCount > 0 ? ` · ${pendingCount}` : ""}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
        <Spacer size={20} />

        {/* The crowd view. Renders nothing at all when there is nothing to
            show, so the feed of people always comes first on an empty city. */}
        <HypeMap />

        {loading && events.length === 0 && (
          <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
        )}

        {view === "error" && (
          <LoadError error={error} onRetry={() => { setLoading(true); load(); }} />
        )}

        {view === "empty" && (
          <View style={styles.empty}>
            <Text style={type.subtitle}>Nobody's eaten yet today.</Text>
            <Text style={[type.small, { marginTop: 8, lineHeight: 20 }]}>
              Every meal anyone logs shows up here. You don't have to add them
              first. Log one and you'll be the one everybody sees.
            </Text>
            <Spacer />
            <Pressable
              onPress={() => router.push("/people")}
              style={styles.emptyCta}
            >
              <Text style={styles.emptyCtaText}>Browse everyone →</Text>
            </Pressable>
          </View>
        )}

        {summary && <Text style={styles.summary}>{summary}</Text>}

        {sections.map((section) => (
          <View key={section.title}>
            <Text style={styles.dayHeader}>{section.title}</Text>
            {section.data.map((ev) => (
              <FeedRow
                key={ev.id}
                event={ev}
                isSelf={ev.user_id === myId}
                graph={graph}
                onLike={() => handleLike(ev)}
                onBlockedUser={removeUser}
                onReportedEvent={removeEvent}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function FeedRow({
  event, isSelf, graph, onLike, onBlockedUser, onReportedEvent,
}: {
  event: FeedEvent;
  isSelf: boolean;
  graph: TasteGraph | null;
  onLike: () => void;
  onBlockedUser: (userId: string) => void;
  onReportedEvent: (eventId: string) => void;
}) {
  const router = useRouter();
  // No email fallback any more — `list_feed` does not return one, on purpose.
  const name = event.user?.display_name
    || (event.user?.username ? `@${event.user.username}` : "Someone");
  const when = relativeTime(event.created_at);

  function doReport(reason: (typeof REPORT_REASONS)[number]["key"]) {
    reportContent({ targetType: "feed_event", targetId: event.id, targetUserId: event.user_id, reason })
      .then(() => {
        onReportedEvent(event.id);
        Alert.alert("Thanks for flagging", "We'll review this within 24 hours. It's hidden from your feed now.");
      })
      .catch((e: any) => Alert.alert("Couldn't report", e?.message ?? "Try again"));
  }

  function doBlock() {
    Alert.alert(
      `Block ${name}?`,
      "You won't see their posts anymore, and you'll be removed as friends.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block", style: "destructive",
          onPress: () => blockUser(event.user_id)
            .then(() => onBlockedUser(event.user_id))
            .catch((e: any) => Alert.alert("Couldn't block", e?.message ?? "Try again")),
        },
      ],
    );
  }

  function openMenu() {
    Alert.alert(name, undefined, [
      {
        text: "Report post",
        onPress: () => Alert.alert("Report post", "Why are you reporting this?", [
          ...REPORT_REASONS.map((r) => ({ text: r.label, onPress: () => doReport(r.key) })),
          { text: "Cancel", style: "cancel" as const },
        ]),
      },
      { text: `Block ${name}`, style: "destructive", onPress: doBlock },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Pressable
          style={styles.rowMain}
          onPress={() => event.user_id && router.push(`/profile/${event.user_id}`)}
        >
          <Avatar uri={event.user?.avatar_url} name={event.user?.display_name} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.when}>{when}</Text>
          </View>
        </Pressable>
        {!isSelf && (
          <Pressable onPress={openMenu} hitSlop={12} style={styles.menuBtn} accessibilityLabel="Post options">
            <Text style={styles.menuDots}>•••</Text>
          </Pressable>
        )}
      </View>

      {event.kind === "visit_logged"
        ? <VisitCard event={event} isSelf={isSelf} graph={graph} />
        : <FeedBody event={event} />}

      <View style={styles.actions}>
        {/* Kudos, not a heart. Strava's word for "I saw this and it counts",
            which is what a like on somebody's dinner actually means. */}
        <Pressable onPress={onLike} style={[styles.kudos, event.iLiked && styles.kudosActive]} accessibilityRole="button">
          <Text style={[styles.kudosText, event.iLiked && styles.kudosTextActive]}>
            {event.iLiked ? "🔥 Kudos" : "Kudos"}{event.likeCount > 0 ? ` · ${event.likeCount}` : ""}
          </Text>
        </Pressable>
        {event.kind === "visit_logged" && !isSelf && event.restaurant?.google_place_id
          && (event.viewerVisitCount ?? 0) === 0 && (
          <SaveButton placeId={event.restaurant.google_place_id} />
        )}
      </View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// A visit, as a card with numbers on it.
// ----------------------------------------------------------------------------
// Header says who and when. The place is the headline. Under it a strip of
// three stats: their nth time here, your match with the place, and whether
// you have been. The last two are about the reader, which is the whole
// difference between a feed people scroll and one they read.
function VisitCard({ event, isSelf, graph }: { event: FeedEvent; isSelf: boolean; graph: TasteGraph | null }) {
  const router = useRouter();
  const p = event.payload as { restaurant_name: string; cuisine: string | null; neighborhood: string | null; google_place_id?: string };
  const placeId = event.restaurant?.google_place_id ?? p.google_place_id ?? null;
  const match = graph && event.restaurant ? getCompatibility(graph, event.restaurant).score : null;
  const nth = ordinalLabel(event.authorVisitOrdinal);
  const been = youveBeenLabel(event.viewerVisitCount, isSelf);
  const meal = mealLine(event.mealType, event.visitedAt);
  const chips = [p.cuisine ? prettyCuisine(p.cuisine) : null, p.neighborhood, meal].filter(Boolean) as string[];

  return (
    <View>
      <Pressable
        onPress={() => placeId && router.push(`/restaurant/${placeId}` as never)}
        disabled={!placeId}
        accessibilityRole={placeId ? "button" : undefined}
      >
        <Text style={styles.place}>{p.restaurant_name}</Text>
        {chips.length > 0 && (
          <Text style={styles.chips}>{chips.join("  ·  ")}</Text>
        )}
      </Pressable>

      {event.photoUrl && (
        <Image source={{ uri: event.photoUrl }} style={styles.photo} resizeMode="cover" />
      )}

      <View style={styles.stats}>
        {nth && (
          <View style={styles.stat}>
            <Text style={styles.statV}>{nth}</Text>
            <Text style={styles.statL}>for them</Text>
          </View>
        )}
        {match != null && (
          <Pressable
            style={[styles.stat, { backgroundColor: matchScoreTint(match), borderColor: matchScoreColor(match) }]}
            onPress={() => placeId && router.push(`/restaurant/${placeId}` as never)}
          >
            <Text style={[styles.statV, { color: matchScoreColor(match) }]}>{Math.round(match)}%</Text>
            <Text style={styles.statL}>your match</Text>
          </Pressable>
        )}
        {been && (
          <View style={styles.stat}>
            <Text style={styles.statV} numberOfLines={1}>{been}</Text>
            <Text style={styles.statL}>you</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function SaveButton({ placeId }: { placeId: string }) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  async function save() {
    if (state !== "idle") return;
    setState("saving");
    try {
      await addToWishlist(placeId, { source: "recommendation" });
      void triggerHapticSuccess();
      setState("saved");
    } catch (e: any) {
      setState("idle");
      Alert.alert("Couldn't save", e?.message ?? "Try again");
    }
  }
  return (
    <Pressable onPress={save} style={[styles.save, state === "saved" && styles.saveDone]} accessibilityRole="button">
      <Text style={[styles.saveText, state === "saved" && styles.saveTextDone]}>
        {state === "saving" ? "…" : state === "saved" ? "Saved" : "Save it"}
      </Text>
    </Pressable>
  );
}

function FeedBody({ event }: { event: FeedEvent }) {
  const router = useRouter();
  if (event.kind === "wrapped_shared") {
    const p = event.payload as {
      persona_label: string; tagline: string; total_visits: number;
      top_restaurant: string | null; top_restaurant_place_id?: string | null;
    };
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
            <Pressable
              style={[styles.wrappedStat, { flex: 1.5 }]}
              disabled={!p.top_restaurant_place_id}
              onPress={() => p.top_restaurant_place_id
                && router.push(`/restaurant/${p.top_restaurant_place_id}` as never)}
              accessibilityRole={p.top_restaurant_place_id ? "button" : undefined}
            >
              {/* Tappable only when the name resolves to exactly one place —
                  older posts carry no id, and a chain visited twice has no
                  single destination. */}
              <Text style={styles.wrappedStatV} numberOfLines={1}>{p.top_restaurant}</Text>
              <Text style={styles.wrappedStatL}>top spot</Text>
            </Pressable>
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
        Logged <Text style={styles.bodyAccent}>{p.restaurant_name}</Text>
        {`, ${cuisineLine}`}{p.neighborhood ? ` in ${p.neighborhood}` : ""}
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
  header: { marginBottom: 12 },
  // Horizontal scroll rather than wrapping: the four chips exceed the width of
  // a small phone, and wrapping them pushed the feed itself below the fold.
  chipRow: { paddingBottom: 12, paddingRight: 4 },
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
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  menuBtn: { paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start" },
  menuDots: { color: colors.mute, fontSize: 16, fontWeight: "800", letterSpacing: 1 },
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

  summary: { ...type.small, marginBottom: 6 },
  dayHeader: { ...type.micro, marginTop: 10, marginBottom: 10 },

  place: { marginTop: 12, fontSize: 20, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 },
  chips: { ...type.small, marginTop: 4 },
  photo: { marginTop: 12, width: "100%", aspectRatio: 16 / 10, borderRadius: 12, backgroundColor: colors.faint },
  stats: { flexDirection: "row", gap: 8, marginTop: 14 },
  stat: {
    flex: 1, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  statV: { fontSize: 15, fontWeight: "800", color: colors.ink },
  statL: { ...type.micro, marginTop: 3, fontSize: 10 },

  actions: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  kudos: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper,
  },
  kudosActive: { borderColor: colors.red, backgroundColor: colors.redTint },
  kudosText: { fontSize: 13, fontWeight: "700", color: colors.ink },
  kudosTextActive: { color: colors.red },
  save: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.red },
  saveDone: { backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line },
  saveText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  saveTextDone: { color: colors.mute },
});
