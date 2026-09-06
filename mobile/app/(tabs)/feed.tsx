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
import { FeedAvatar } from "../../components/FeedAvatar";
import { cuisineHue } from "../../components/PlaceArt";
import { placeFacts } from "../../lib/place-facts";
import { FONT_CAP } from "../../lib/a11y";
import { colors, categoryColors, radius, shadow, spacing, type } from "../../theme";
import { listFeed, toggleLike, type FeedEvent } from "../../lib/feed";
import { loadView } from "../../lib/load-state";
import { LoadError } from "../../components/LoadError";
import { reportContent, blockUser, REPORT_REASONS } from "../../lib/moderation";
import { supabase } from "../../lib/supabase";

export default function FeedTab() {
  const router = useRouter();
  const [events, setEvents] = useState<FeedEvent[]>([]);
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
      const [feed, { data: auth }] = await Promise.all([
        listFeed(60),
        supabase.auth.getUser(),
      ]);
      setEvents(feed);
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
            <Pressable onPress={() => router.push("/board")} style={styles.friendsBtn}>
              <Text style={styles.friendsBtnText}>Board</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/people")} style={styles.friendsBtn}>
              <Text style={styles.friendsBtnText}>People</Text>
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
            {/* A saffron dot in front of each day. The headers are the only
                thing between one white card and the next, and grey uppercase
                alone disappears against the grey page. */}
            <View style={styles.dayHeader}>
              <View style={styles.dayDot} accessibilityElementsHidden importantForAccessibility="no" />
              <Text style={styles.dayHeaderText}>{section.title}</Text>
            </View>
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
      "You won't see their posts anymore, and you'll stop following each other.",
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

  // A visit card wears its place's cuisine hue on a rail down the left edge,
  // the same hue that place has on Home and Discover. The restaurant row is
  // the live classification; the payload's cuisine is the snapshot the post
  // was written with, kept as the fallback for posts whose row is gone.
  const hue = event.kind === "visit_logged" ? visitHue(event) : null;

  return (
    // Two layers on purpose. The rail has to be clipped to the card's rounded
    // corners, which needs overflow hidden, and on iOS overflow hidden on the
    // view that carries the shadow clips the shadow too. So the outer view
    // owns the shadow and the inner one owns the clipping.
    <View style={styles.card}>
    <View style={styles.cardClip}>
      {hue && <View style={[styles.rail, { backgroundColor: hue }]} />}
      <View style={styles.row}>
        <Pressable
          style={styles.rowMain}
          onPress={() => event.user_id && router.push(`/profile/${event.user_id}`)}
        >
          <FeedAvatar uri={event.user?.avatar_url} name={event.user?.display_name} size={40} />
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
        ? <VisitCard event={event} isSelf={isSelf} graph={graph} hue={hue ?? colors.ink} />
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
    </View>
  );
}

/** The hue a visit post wears: the live restaurant row's cuisine first, the
 *  payload's snapshot second, both seeded by the place id so a place with no
 *  known cuisine still gets one stable colour. */
function visitHue(event: FeedEvent): string {
  const p = event.payload as { cuisine: string | null; google_place_id?: string };
  const placeId = event.restaurant?.google_place_id ?? p.google_place_id ?? "";
  return cuisineHue(event.restaurant?.cuisine_type ?? p.cuisine, placeId);
}

// ----------------------------------------------------------------------------
// A visit, as a card with numbers on it.
// ----------------------------------------------------------------------------
// Header says who and when. The place is the headline. Under it a strip of
// three stats: their nth time here, your match with the place, and whether
// you have been. The last two are about the reader, which is the whole
// difference between a feed people scroll and one they read.
function VisitCard({ event, isSelf, graph, hue }: { event: FeedEvent; isSelf: boolean; graph: TasteGraph | null; hue: string }) {
  const router = useRouter();
  const p = event.payload as { restaurant_name: string; cuisine: string | null; neighborhood: string | null; google_place_id?: string };
  const placeId = event.restaurant?.google_place_id ?? p.google_place_id ?? null;
  const match = graph && event.restaurant ? getCompatibility(graph, event.restaurant).score : null;
  const nth = ordinalLabel(event.authorVisitOrdinal);
  const been = youveBeenLabel(event.viewerVisitCount, isSelf);
  const meal = mealLine(event.mealType, event.visitedAt);
  // The cuisine is the one word on this line that carries colour, so it
  // leaves the joined string and becomes a pill; neighborhood and meal stay
  // muted text beside it.
  // list_feed already returns the catalogue row's rating, price and review
  // count (migration 0096); the card just never read them. A place somebody
  // went to is exactly where the two numbers a diner reads first belong.
  const facts = placeFacts(event.restaurant ?? {});
  const subline = [facts.rating, facts.price, p.neighborhood, meal]
    .filter(Boolean).join("  ·  ");
  // Green means "you have a history here", grey means you do not. The label
  // already says which; the colour lets you read it from across the row.
  const beenColor = (event.viewerVisitCount ?? 0) > 0 ? categoryColors.pine : colors.mute;

  return (
    <View>
      <Pressable
        onPress={() => placeId && router.push(`/restaurant/${placeId}` as never)}
        disabled={!placeId}
        accessibilityRole={placeId ? "button" : undefined}
      >
        <Text style={styles.place}>{p.restaurant_name}</Text>
        {(p.cuisine || subline) && (
          <View style={styles.chipLine}>
            {p.cuisine && (
              <View style={[styles.cuisinePill, { backgroundColor: hue + "1F" }]}>
                <Text style={[styles.cuisinePillText, { color: hue }]} maxFontSizeMultiplier={FONT_CAP.chrome}>
                  {prettyCuisine(p.cuisine)}
                </Text>
              </View>
            )}
            {!!subline && <Text style={styles.chips}>{subline}</Text>}
          </View>
        )}
      </Pressable>

      {event.photoUrl && (
        <Image source={{ uri: event.photoUrl }} style={styles.photo} resizeMode="cover" />
      )}

      <View style={styles.stats}>
        {nth && (
          <View style={styles.stat}>
            <Text style={[styles.statV, styles.statOrdinal]}>{nth}</Text>
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
            <Text style={[styles.statV, { color: beenColor }]} numberOfLines={1}>{been}</Text>
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
        <View style={styles.wrappedEyebrowRow}>
          <View style={styles.dayDot} accessibilityElementsHidden importantForAccessibility="no" />
          <Text style={styles.wrappedEyebrow}>WEEKLY WRAPPED</Text>
        </View>
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
  // The empty state is a card like any other: white on the grey page, no
  // hairline. Paper-on-paper with a border was the look being replaced.
  empty: {
    padding: spacing.lg, borderRadius: radius.md,
    backgroundColor: colors.faint,
    ...shadow.card,
  },
  emptyCta: {
    alignSelf: "flex-start",
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 999, backgroundColor: colors.red,
  },
  emptyCtaText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  // White card on the grey page, carried by shadow rather than a border. The
  // cards used to be paper on paper with a hairline, which is why the feed
  // read as one long grey column instead of a stack of posts. Padding lives
  // on cardClip so the rail can run the card's full height at its edge.
  card: {
    marginBottom: 14,
    borderRadius: radius.md,
    backgroundColor: colors.faint,
    ...shadow.card,
  },
  cardClip: {
    borderRadius: radius.md,
    overflow: "hidden",
    padding: spacing.md,
  },
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  menuBtn: { paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start" },
  menuDots: { color: colors.mute, fontSize: 16, fontWeight: "800", letterSpacing: 1 },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
  when: { ...type.small, marginTop: 2 },

  bodyText: { marginTop: 12, fontSize: 16, color: colors.ink, lineHeight: 22 },
  // redText, not red: this is body-size text on white, and the brighter
  // brand red does not clear AA at that size.
  bodyAccent: { color: colors.redText, fontWeight: "700" },

  wrappedCard: {
    marginTop: 12,
    padding: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.ink,
  },
  wrappedEyebrowRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  wrappedEyebrow: { color: "rgba(255,255,255,0.6)", fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },
  wrappedPersona: { color: colors.red, fontSize: 24, fontWeight: "800", letterSpacing: -0.5, marginTop: 4 },
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
  dayHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, marginBottom: 10 },
  dayHeaderText: { ...type.micro, flexShrink: 1 },
  dayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: categoryColors.saffron },

  place: { marginTop: 12, fontSize: 20, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 },
  // Wraps, so a long neighborhood at a large text size drops under the pill
  // instead of squeezing it.
  chipLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 6 },
  cuisinePill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  cuisinePillText: { fontSize: 13, fontWeight: "700" },
  chips: { ...type.small, flexShrink: 1 },
  photo: { marginTop: 12, width: "100%", aspectRatio: 16 / 10, borderRadius: 12, backgroundColor: colors.wash },
  stats: { flexDirection: "row", gap: 8, marginTop: 14 },
  // Wash on the white card, with the border painted the same wash so it
  // costs no layout. The match tile overrides both with its score tint and
  // colour, which is the one tile that earns a visible edge.
  stat: {
    flex: 1, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12,
    backgroundColor: colors.wash, borderWidth: 1, borderColor: colors.wash,
  },
  statV: { fontSize: 16, fontWeight: "800", color: colors.ink },
  statOrdinal: { color: categoryColors.plum },
  statL: { ...type.micro, marginTop: 3, fontSize: 10 },

  actions: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  // Controls on a white card fill with wash; paper here was a grey blot on
  // white. Active is the soft red tint with the darker red text that clears
  // AA at 13px, not the brand red, which is for the Save CTA beside it.
  kudos: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
    borderWidth: 1, borderColor: colors.wash, backgroundColor: colors.wash,
  },
  kudosActive: { borderColor: colors.redTintBorder, backgroundColor: colors.redTint },
  kudosText: { fontSize: 13, fontWeight: "700", color: colors.ink },
  kudosTextActive: { color: colors.redText },
  save: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.red },
  // Wash, not faint: a saved Save on a white card was white on white and
  // read as an outline only.
  saveDone: { backgroundColor: colors.wash, borderWidth: 1, borderColor: colors.wash },
  saveText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  saveTextDone: { color: colors.mute },
});
