import React from "react";
import { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Pressable, Alert, Animated, Easing } from "react-native";
import { Text } from "./Text";
import { useRouter } from "expo-router";
import { colors, spacing, type, card, shadow, categoryColors } from "../theme";
import type { RankedRestaurant } from "../lib/recommendation/types";
import { addToWishlist } from "../lib/palate-insights";
import { triggerHapticSuccess, triggerHapticSelection } from "../lib/haptics";
import { pickSaveCopy } from "../lib/save-copy";
import { openInAppleMaps, openInGoogleMaps } from "../lib/maps";
import { trackRecEvent, trackImpression, rememberRecTouch, type RecEventContext } from "../lib/recommendation-events";
import { Impression } from "./Impressions";
import { askNotInterested } from "./notInterested";
import { formatDistance, matchScoreColor, matchBand } from "../lib/match-score";
import { AnimatedNumber } from "./AnimatedNumber";
import { SaveBurst } from "./SaveBurst";
import { TapCard } from "./TapCard";
import { PlaceArt, PlaceTile, cuisineHue } from "./PlaceArt";
import { cachedPlacePhoto } from "../lib/place-photos";

// ============================================================================
// RestaurantCompatibilityCard — single card UI used everywhere a restaurant
// is recommended. Shows the Palate Match Score, a one-line reason, distance,
// secondary rating, and Save / "Not for me" / Maps buttons.
// ============================================================================

type Props = {
  restaurant: RankedRestaurant;
  surface: RecEventContext["surface"];
  bucket?: RecEventContext["bucket"];
  onDismissed?: () => void;
  /** When set, replaces the personal-compat reason with this verbatim string
   *  (no shortDescriptor truncation). Used by Featured Lists to show place
   *  facts ("4.6 ★ · 1.2k reviews · $$") instead of misleading "matches your
   *  X pattern" copy on a list that's intentionally not personalized. */
  reasonOverride?: string;
  /** 0-based position in the list, one id per ranking pass, and whether this
   *  is the explore slot. Together they make every event on this card
   *  attributable — see lib/recommendation-events.ts. */
  rank?: number;
  requestId?: string;
  slot?: "exploit" | "explore";
  mood?: string | null;
};

export function RestaurantCompatibilityCard({ restaurant, surface, bucket, onDismissed, reasonOverride, rank, requestId, slot, mood }: Props) {
  const router = useRouter();
  const photo = cachedPlacePhoto(restaurant.google_place_id);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [burstKey, setBurstKey] = useState(0);
  const m = restaurant.match;
  // One context for every event this card fires, so a click, a save and a
  // directions tap on the same card are recognisably the same showing.
  const ctx: RecEventContext = {
    surface, bucket, rank, slot, mood,
    request_id: requestId,
    matchScore: m.score,
    finalScore: restaurant.score?.finalScore,
  };

  // Spring entrance — fade + slide up the first time the card mounts.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [enter]);
  const enterStyle = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  };

  if (dismissed) return null;

  function openDetail() {
    rememberRecTouch(restaurant.google_place_id, ctx);
    void trackRecEvent("restaurant_clicked", restaurant.google_place_id, ctx);
    if (bucket === "stretch") {
      void trackRecEvent("stretch_pick_clicked", restaurant.google_place_id, ctx);
    }
    router.push(`/restaurant/${restaurant.google_place_id}` as any);
  }

  async function save() {
    if (saved || saving) return;
    setSaving(true);
    try {
      await addToWishlist(restaurant.google_place_id, { source: "recommendation" });
      void triggerHapticSuccess();
      void trackRecEvent("restaurant_saved", restaurant.google_place_id, ctx);
      setSaved(true);
      setBurstKey((k) => k + 1);
      const c = pickSaveCopy();
      setTimeout(() => Alert.alert(c.title, c.body), 350);
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "Try again");
    } finally {
      setSaving(false);
    }
  }

  const hue = cuisineHue(restaurant.cuisine_type, restaurant.google_place_id);
  // Google's rating leads. It is the one number every diner already reads,
  // and hiding it made the card look like it was withholding something.
  // Price sits right after it and the review count closes the line: "$$" and
  // "1.2k reviews" are what a diner checks to decide whether the rating means
  // anything, and the card was making them tap through for both. Both stay
  // in the muted line colour; the star and the cuisine word carry the hue.
  const price = priceMarks(restaurant.price_level);
  const reviews = reviewCount(restaurant.user_rating_count);
  const sublineParts: React.ReactNode[] = [
    restaurant.rating != null ? <Text key="r" style={styles.star}>★ {restaurant.rating.toFixed(1)}</Text> : null,
    price,
    restaurant.cuisine_type ? <Text key="c" style={[styles.cuisineText, { color: hue }]}>{cap(restaurant.cuisine_type)}</Text> : null,
    restaurant.neighborhood || null,
    restaurant.distanceKm != null ? formatDistance(restaurant.distanceKm) : null,
    reviews,
  ].filter((p) => p != null && p !== "");
  const subline: React.ReactNode[] = [];
  sublineParts.forEach((p, i) => {
    if (i > 0) subline.push(<Text key={`d${i}`}> · </Text>);
    subline.push(p);
  });

  function showLessLikeThis() {
    askNotInterested(
      { google_place_id: restaurant.google_place_id, name: restaurant.name },
      { surface, onDone: () => { setDismissed(true); onDismissed?.(); } },
    );
  }

  return (
    <Impression
      id={restaurant.google_place_id}
      surface={surface}
      onSeen={() => trackImpression(restaurant.google_place_id, ctx)}
    >
    <Animated.View style={enterStyle}>
    <TapCard onPress={openDetail} onLongPress={showLessLikeThis} style={styles.card}>
    {/* Shadow on the outer view, clipping on the inner one: iOS drops a
        view's own shadow when that view clips its children, so one view
        cannot both cast the card shadow and cut the art and the rail to
        the rounded corners. Home and Feed cards are built the same way. */}
    <View style={styles.cardClip}>
      {/* Art ONLY when there is a real photo. A gradient with two initials
          is not visual — it is a 132pt loading skeleton that never loads, and
          it pushes the name, the match and the reason below the fold. The
          moment someone photographs this place, the card becomes a picture
          card; until then the dense list is the better answer. */}
      {!!photo && (
        <PlaceArt
          seed={restaurant.google_place_id}
          name={restaurant.name}
          cuisine={restaurant.cuisine_type}
          photoUrl={photo}
        />
      )}
      {/* A rail in the cuisine's hue down the card's edge. The list was a
          column of identical white cards; this is the cheapest way to make
          five of them read as five different places. */}
      <View style={[styles.rail, { backgroundColor: hue }]} />
      <View style={styles.body}>
      <View style={styles.head}>
        {/* No photo used to mean no picture at all here: a card of grey text.
            The tile is the same gradient the full-width art would have used,
            at row scale, so the card has a face either way. */}
        {!photo && (
          <PlaceTile
            seed={restaurant.google_place_id}
            name={restaurant.name}
            cuisine={restaurant.cuisine_type}
            size={56}
            style={styles.tile}
          />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={2}>{restaurant.name}</Text>
          <Text style={styles.sub}>{subline.length ? subline : "Nearby"}</Text>
        </View>
        <View style={styles.scoreCol}>
          {m.confidence === "low" ? (
            // No real taste signal yet — don't show a precise "% match" we
            // can't stand behind (it read ~62% on everything). Once the user
            // has logged a few visits, confidence rises and the number returns.
            <>
              <Text style={styles.newBadge}>NEW</Text>
              <Text style={styles.scoreLabel}>to you</Text>
            </>
          ) : (
            <>
              {/* Was a large glowing number in brand red — the loudest thing on
                  the card, above the restaurant's own name, asserting that 93
                  and 88 are meaningfully different when they are not. A banded
                  word carries the same information at the precision the model
                  actually has, and the figure stays underneath for anyone who
                  wants it. */}
              <Text style={[styles.scoreBand, { color: matchScoreColor(m.score) }]}>
                {matchBand(m.score)}
              </Text>
              <Text style={styles.scoreLabel}>{m.score}% match</Text>
            </>
          )}
        </View>
      </View>

      {/* Override mode: render verbatim (used by Featured Lists for facts).
          Otherwise use the strict 5-word descriptor format. */}
      {reasonOverride ? (
        <Text style={styles.reason}>{reasonOverride}</Text>
      ) : m.reasons[0] ? (
        <Text style={styles.reason}>{shortDescriptor(m.reasons[0])}</Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={(e) => { e.stopPropagation(); showLessLikeThis(); }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Not interested in ${restaurant.name}`}
          style={styles.hideBtn}
        >
          <Text style={styles.hideText}>✕</Text>
        </Pressable>
        <View>
          <Pressable
            onPress={(e) => { e.stopPropagation(); save(); }}
            disabled={saved}
            style={[styles.btnPrimary, saved && styles.btnDone]}
          >
            <Text style={[styles.btnPrimaryText, saved && styles.btnDoneText]}>
              {saving ? "…" : saved ? "Saved" : "Save"}
            </Text>
          </Pressable>
          <SaveBurst fire={burstKey} />
        </View>
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            void trackRecEvent("maps_opened", restaurant.google_place_id, { ...ctx, provider: "apple" });
            openInAppleMaps(restaurant.name, { lat: restaurant.latitude, lng: restaurant.longitude });
          }}
          onLongPress={(e) => {
            e.stopPropagation();
            void trackRecEvent("maps_opened", restaurant.google_place_id, { ...ctx, provider: "google" });
            openInGoogleMaps(restaurant.name, { lat: restaurant.latitude, lng: restaurant.longitude, placeId: restaurant.google_place_id });
          }}
          style={styles.btnGhost}
        >
          <Text style={styles.btnGhostText}>Maps</Text>
        </Pressable>
        {/* "Pass" button removed per UX feedback — felt punitive on a card
            that's already showing a high match score. Negative signal still
            captured implicitly via skips when the user scrolls past. */}
      </View>
      </View>
    </View>
    </TapCard>
    </Animated.View>
    </Impression>
  );
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
}

// Generic categories that, when used as the entire reason line, are useless
// to the user ("bar", "café"). If our shortened reason collapses to one of
// these, we fall back to the full sentence or to a generic-but-honest line.
const STUB_REASONS = new Set([
  "bar", "cafe", "café", "restaurant", "food", "place",
  "within the kind of place", "in your usual lane",
]);

/**
 * Render the recommendation reason as a short, human line — max ~12 words.
 * The compatibility scorer already produces sentences like "Matches your Bar
 * habit." We keep them mostly intact (just trim the trailing period) so they
 * read as English, not chip text. Only when the reason explicitly looks like
 * a generic placeholder do we substitute a fallback.
 */
function shortDescriptor(raw: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  if (!trimmed) return "Similar to places you usually like";

  // Reason was a single bare category like "Bar" or "Café" — that's the
  // pre-fix bug. Substitute a clearer line.
  const lower = trimmed.toLowerCase();
  if (STUB_REASONS.has(lower)) return "Similar to places you usually like";

  // Cap at ~12 words. Going longer risks wrapping awkwardly on a card.
  const words = trimmed.split(/\s+/);
  if (words.length <= 12) return ensurePunctuation(trimmed);
  return ensurePunctuation(words.slice(0, 12).join(" "));
}

function ensurePunctuation(s: string): string {
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** "$" to "$$$$" for Google's 1..4 price level. Null for 0 (free), for a
 *  missing value and for anything out of range, so the subline simply omits
 *  it rather than printing an empty slot between two dots. */
function priceMarks(level: number | null | undefined): string | null {
  if (level == null || !Number.isFinite(level)) return null;
  const n = Math.round(level);
  if (n < 1) return null;
  return "$".repeat(Math.min(4, n));
}

/** "1.2k reviews", "38 reviews", "1 review". Null when Google has no count,
 *  so a place nobody has reviewed does not advertise "0 reviews". */
function reviewCount(n: number | null | undefined): string | null {
  if (n == null || !(n > 0)) return null;
  return `${formatCount(n)} ${n === 1 ? "review" : "reviews"}`;
}

const styles = StyleSheet.create({
  body: { padding: card.padding },
  card: {
    // No padding: the art runs edge to edge, and the body below sets its own.
    borderRadius: card.radius,
    // Stays white. An 8% wash of the cuisine hue behind the body was worked
    // out on paper and rejected: over white the cooler hues land at #F4EFF2
    // (plum) and #EFF4F4 (pine), both darker than the page's #F6F6F6, so the
    // card stops popping off the grey and sinks into it. The rail carries
    // the hue instead.
    backgroundColor: colors.faint,
    marginBottom: 10,
    ...shadow.card,
  },
  cardClip: { borderRadius: card.radius, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  // Name is the primary visual element on the card.
  name: { fontSize: 20, fontWeight: "800", color: colors.ink, letterSpacing: -0.3, lineHeight: 24 },
  sub: { ...type.small, marginTop: 4 },
  // Score is highlighted but smaller than the name so it never out-competes
  // the restaurant identity itself.
  scoreCol: { alignItems: "flex-end", minWidth: 72 },
  scoreBand: { fontSize: 13, fontWeight: "800", letterSpacing: -0.1, textAlign: "right" },
  scoreLabel: {
    fontSize: 10, fontWeight: "700", color: colors.mute, letterSpacing: 0.3,
    marginTop: 2, textAlign: "right",
  },
  confLow: { fontSize: 10, fontWeight: "700", color: colors.mute, marginTop: 4 },
  newBadge: { fontSize: 16, fontWeight: "800", color: colors.mute, letterSpacing: 1 },

  reason: { marginTop: 10, fontSize: 13, color: colors.ink, fontStyle: "italic", lineHeight: 20 },

  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  tag: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  tagText: { fontSize: 10, fontWeight: "700", color: colors.ink },

  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  tile: { marginRight: 12 },
  star: { color: categoryColors.saffron, fontWeight: "700" },
  cuisineText: { fontWeight: "700" },

  actions: { marginTop: 12, flexDirection: "row", gap: 6, flexWrap: "wrap" },
  btnPrimary: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.red,
  },
  btnPrimaryText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  btnDone: { backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line },
  btnDoneText: { color: colors.mute },
  btnGhost: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  btnGhostText: { fontSize: 13, fontWeight: "700", color: colors.ink },
  btnSubtle: { paddingHorizontal: 10, paddingVertical: 8, marginLeft: "auto" },
  btnSubtleText: { fontSize: 11, fontWeight: "600", color: colors.mute },
  hideBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line },
  hideText: { fontSize: 13, fontWeight: "800", color: colors.mute },
});
