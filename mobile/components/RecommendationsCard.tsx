import { useEffect, useState, useCallback, useRef } from "react";
import { View, StyleSheet, Pressable, ActivityIndicator, Alert } from "react-native";
import { Text } from "./Text";
import { colors, spacing, type, card, shadow } from "../theme";
import { isoWeekStart } from "../lib/wrapped";
import {
  generateWeeklyPalatePersona,
  getPersonaRecommendations,
} from "../lib/palate-persona";
import {
  addToWishlist,
  type RestaurantRecommendation,
  type AspirationTag,
} from "../lib/palate-insights";
import { computeTasteVector } from "../lib/taste-vector";
import { distanceKm, formatDistance } from "../lib/match-score";
import { getEffectiveLocation, useBrowsingCity } from "../lib/browsing-location";
import { loadPersonalSignal } from "../lib/personal-signal";
import { nearbyRestaurants } from "../lib/places";
import { getOrFetchNearby } from "../lib/nearby-cache";
import { assembleGraph, getCompatibility } from "../lib/recommendation";
import { filterRecommendable } from "../lib/recommendation/eligibility";
import { triggerHapticSuccess, triggerHapticSelection } from "../lib/haptics";
import { pickSaveCopy } from "../lib/save-copy";
import { openInAppleMaps, openInGoogleMaps } from "../lib/maps";
import { matchScoreColor, matchScoreTint } from "../lib/match-score";
import { AnimatedNumber } from "./AnimatedNumber";
import { SaveBurst } from "./SaveBurst";
import { applyMood, moodFallbackNote, moodContextNote, isIntentMood, isSurprise, isDishMood, dishOf, moodLabel, type Mood } from "../lib/mood";
import { cuisinesNear, cuisineCandidates, dishCandidates, mergeCuisinePools } from "../lib/cuisine-catalogue";
import { FONT_CAP, useFontScale } from "../lib/a11y";
import { useRouter } from "expo-router";
import { TapCard } from "./TapCard";

// ============================================================================
// RecommendationsCard — always-visible spot suggestions on the Home tab.
// ----------------------------------------------------------------------------
// Time-of-day aware via the headline copy (morning -> "for your morning",
// midday -> "for lunch", evening -> "for tonight"). Pulls 2 personas-driven
// picks for fast scanning. Each row is tappable to save to wishlist.
// ============================================================================

// Card kept intentionally bare per the "Home = decision only" brief.
// No time-of-day blurbs, no explanatory subtitles — the title and the rows
// are the whole story.

// ----------------------------------------------------------------------------
// One place a Restaurant row becomes a scored recommendation.
// ----------------------------------------------------------------------------
// Pulled out of `load` because the catalogue path needs exactly the same
// treatment: a steakhouse fetched because you asked for steakhouses has to be
// scored on the same graph, or the % match beside it would mean something
// different from the % match beside everything else on the screen.
function toRecommendation(
  p: any,
  graph: ReturnType<typeof assembleGraph>,
  here: { lat: number; lng: number },
  personal: { visitsByPlaceId: Map<string, number> } | null,
): RestaurantRecommendation {
  const compat = getCompatibility(graph, {
    google_place_id: p.google_place_id,
    name: p.name,
    cuisine_type: p.cuisine_type ?? null,
    cuisine_region: p.cuisine_region ?? null,
    cuisine_subregion: p.cuisine_subregion ?? null,
    format_class: p.format_class ?? null,
    occasion_tags: p.occasion_tags ?? null,
    flavor_tags: p.flavor_tags ?? null,
    cultural_context: p.cultural_context ?? null,
    neighborhood: p.neighborhood ?? null,
    price_level: p.price_level ?? null,
    rating: p.rating ?? null,
    user_rating_count: p.user_rating_count ?? null,
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
  });
  const dKm = (p.latitude != null && p.longitude != null)
    ? distanceKm({ lat: here.lat, lng: here.lng }, { lat: p.latitude, lng: p.longitude })
    : null;
  return {
    google_place_id: p.google_place_id,
    name: p.name,
    cuisine: p.cuisine_type ?? null,
    // Carried for the non-cuisine moods. format_class was already read for
    // scoring and then dropped; "Quick" and "Sit down" need it, and "Somewhere
    // new" needs to know whether you have been.
    format_class: p.format_class ?? null,
    dish_family: p.dish_family ?? null,
    visited: (personal?.visitsByPlaceId.get(p.google_place_id) ?? 0) > 0,
    neighborhood: p.neighborhood ?? null,
    price_level: p.price_level ?? null,
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
    rating: p.rating ?? null,
    matchScore: compat.score,
    distanceKm: dKm,
    reason: compat.reasons[0] ?? "Nearby and worth a try.",
  } as RestaurantRecommendation;
}

export function RecommendationsCard({
  mood = null,
  habitualCuisines = [],
  excludePlaceIds = [],
  onCuisinesAvailable,
}: {
  /** Temporary cuisine override from the mood row. null = Anything. */
  mood?: Mood;
  /** The user's usual cuisines — what "Surprise me" must avoid. */
  habitualCuisines?: string[];
  /** Venues already shown above — currently the Right Now hero. Both surfaces
   *  rank the same nearby pool on the same taste graph, so the top pick landed
   *  in both by default rather than by accident. */
  excludePlaceIds?: string[];
  /** Cuisines present in the nearby pool, so the chip row above can offer a
   *  cuisine the user has never eaten. The pool lives here; the chips do not. */
  onCuisinesAvailable?: (pool: Array<{ cuisine_type?: string | null }>) => void;
} = {}) {
  const [recs, setRecs] = useState<RestaurantRecommendation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [earlyEstimate, setEarlyEstimate] = useState(false);
  const [allRecs, setAllRecs] = useState<RestaurantRecommendation[] | null>(null);
  const [browsingCity] = useBrowsingCity();
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  // How many places the current mood produced. Shown in the header so a
  // chip that changed the list is visibly a chip that changed the list.
  const [moodCount, setMoodCount] = useState<number | null>(null);
  // Kept from the load so a mood picked afterwards can score catalogue places
  // on the same graph. Without it, asking for a cuisine that is not in the
  // nearby pool would have to re-derive the taste vector on every chip tap.
  const scoringRef = useRef<{
    graph: ReturnType<typeof assembleGraph>;
    here: { lat: number; lng: number };
    personal: Awaited<ReturnType<typeof loadPersonalSignal>> | null;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [vector, here, personal] = await Promise.all([
        computeTasteVector().catch(() => null),
        getEffectiveLocation().catch(() => null),
        loadPersonalSignal().catch(() => null),
      ]);
      if (!here) {
        setRecs([]);
        return;
      }
      // Reset on every load — once you log your 5th visit the badge
      // should disappear next render, not stay sticky from a prior load.
      setEarlyEstimate(vector ? vector.visitCount < 5 : false);

      // CANONICAL PATH — single source of truth. Same scorer Discover and
      // Map use, so the % match shown on Home for a given restaurant is
      // identical to its % match anywhere else.
      const nearby = await getOrFetchNearby(here.lat, here.lng, 3000, nearbyRestaurants);
      const graph = assembleGraph(vector, personal);

      // Visited place IDs — used for anti-staleness on the recs feed. We
      // don't want Home to keep recommending places you've already been to
      // many times. (Personal signal already tracks visit counts.)
      const visitedHeavy = new Set<string>();
      for (const [placeId, n] of personal?.visitsByPlaceId.entries() ?? []) {
        if (n >= 3) visitedHeavy.add(placeId);
      }

      // One gate for every surface (lib/recommendation/eligibility.ts) — the
      // old `eligibility > 0` check only caught venues the classifier had
      // already labeled, so unclassified chains still reached this list.
      const enriched: RestaurantRecommendation[] = filterRecommendable(nearby)
        .filter((p) => !visitedHeavy.has(p.google_place_id))
        .filter((p) => !excludePlaceIds.includes(p.google_place_id))
        .map((p) => toRecommendation(p, graph, here, personal));

      // Sort by canonical compatibility (high → low). Keep the full ranked
      // list so a mood can re-slice it without another network round trip —
      // switching mood should feel instant.
      enriched.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
      setAllRecs(enriched);
      scoringRef.current = { graph, here, personal };
      setRecs(enriched.slice(0, 3));

      // The chips offered above are the union of what is in this pool and what
      // exists in the catalogue within reach. The pool is a 3km Google fetch,
      // so on its own it decides which cuisines are even askable — and it left
      // out anything with no venue in that particular slice. The catalogue read
      // is a Postgres query against rows we already own, so widening the offer
      // costs nothing.
      const pool = enriched.map((r) => ({ cuisine_type: (r as any).cuisine ?? null }));
      onCuisinesAvailable?.(pool);
      void cuisinesNear(here.lat, here.lng)
        .then((cat) => onCuisinesAvailable?.(mergeCuisinePools(pool, cat)))
        .catch(() => {});
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, browsingCity?.id]);

  // A mood filters the SAME personally-ranked list. The compat score still
  // comes from the user's own history — we only restrict which venues are
  // eligible for the three slots.
  const [moodNote, setMoodNote] = useState<string | null>(null);
  useEffect(() => {
    if (!allRecs) return;
    let alive = true;
    const { items, matched } = applyMood(allRecs, mood, habitualCuisines);

    // A cuisine the nearby pool does not contain used to end here: applyMood
    // returned the UNFILTERED list with matched=false, so tapping "Steakhouse"
    // showed the same three places as "Anything" under a line apologising for
    // it. The chip read as broken because it was.
    //
    // The catalogue knows better. Ask it for that cuisine, score what comes
    // back on the same graph, and show it. A low match is the honest answer to
    // "I never eat this", and moodContextNote says so in words.
    const wantsCatalogue =
      typeof mood === "string" && !isIntentMood(mood) && !isSurprise(mood) && !matched;

    if (wantsCatalogue && scoringRef.current) {
      const { graph, here, personal } = scoringRef.current;
      setCatalogueLoading(true);
      const fetchCandidates = isDishMood(mood)
        ? dishCandidates(here, dishOf(mood) ?? "")
        : cuisineCandidates(here, String(mood));
      void fetchCandidates
        .then((rows) => {
          if (!alive) return;
          const scored = rows
            .map((r) => toRecommendation(r, graph, here, personal))
            .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
          if (scored.length === 0) {
            // Genuinely nothing of that cuisine within reach. That is a real
            // answer and it is not the same as a failed filter, so it gets its
            // own sentence rather than the fallback list.
            setRecs(items.slice(0, 3));
            setMoodCount(0);
            setMoodNote(moodFallbackNote(mood));
            return;
          }
          setRecs(scored.slice(0, 3));
          setMoodCount(scored.length);
          setMoodNote(moodContextNote(mood, scored[0].matchScore ?? null));
        })
        .catch(() => {
          if (!alive) return;
          setRecs(items.slice(0, 3));
          setMoodNote(moodFallbackNote(mood));
        })
        .finally(() => { if (alive) setCatalogueLoading(false); });
      return () => { alive = false; };
    }

    setRecs(items.slice(0, 3));
    setMoodCount(mood && matched ? items.length : mood ? 0 : null);
    const top = items.length > 0 ? items[0].matchScore ?? null : null;
    // "Nothing matched" and "these matched and are not your thing" are
    // different things to say, and saying the second is what lets somebody ask
    // for a cuisine they never eat and still get an answer.
    setMoodNote(
      mood && !matched
        ? moodFallbackNote(mood)
        : moodContextNote(mood, typeof top === "number" ? top : null),
    );
    return () => { alive = false; };
  }, [allRecs, mood, habitualCuisines]);

  // Hide the card entirely until we know if we have anything to show — keeps
  // the Home tab from flashing a useless block on first load.
  if (loading) return null;
  if (error) return null;
  // Empty state — no nearby restaurants found at all (rare). Render an
  // inviting nudge instead of silently disappearing.
  if (!recs || recs.length === 0) {
    return (
      <View style={[styles.card, styles.emptyCard]}>
        <Text style={styles.eyebrow}>MOST COMPATIBLE</Text>
        <View style={styles.emptyState}>
          <Text style={styles.emptyGlyph}>◎</Text>
          <Text style={styles.emptyText}>No spots nearby yet.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {/* No "MOST COMPATIBLE" eyebrow. Home now asks "What are you in the mood
          for?" directly above this and the chips answer it, so a label saying
          what the list is was a third heading for one list. The early-read
          caveat is kept — that one says something the question does not. */}
      {earlyEstimate && (
        <Text style={styles.eyebrow} maxFontSizeMultiplier={FONT_CAP.eyebrow}>
          A FIRST READ ON YOUR PALATE
        </Text>
      )}
      {typeof mood === "string" && !isIntentMood(mood) && !isSurprise(mood) && (
        <Text style={styles.moodHead}>
          {moodLabel(mood)} near you
          {moodCount != null && !catalogueLoading ? ` · ${moodCount} ${moodCount === 1 ? "place" : "places"}` : ""}
        </Text>
      )}
      {catalogueLoading
        ? <Text style={styles.moodNote}>Looking further out for {moodLabel(mood)}…</Text>
        : !!moodNote && <Text style={styles.moodNote}>{moodNote}</Text>}
      <View style={{ marginTop: earlyEstimate ? 14 : 2 }}>
        {recs.map((rec) => (
          <RecRow key={rec.google_place_id} rec={rec} />
        ))}
      </View>
    </View>
  );
}

function RecRow({ rec }: { rec: RestaurantRecommendation }) {
  const router = useRouter();
  // At large accessibility sizes [name | match | Save] compresses the name to
  // an ellipsis and the buttons to slivers. Past the threshold the row becomes
  // a column: same information, in an order that still reads.
  const { stack } = useFontScale();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [burstKey, setBurstKey] = useState(0);

  async function save() {
    if (saved || saving) return;
    setSaving(true);
    try {
      await addToWishlist(rec.google_place_id, {
        source: "recommendation",
        aspirationTags: inferAspirationTags(rec),
      });
      void triggerHapticSuccess();
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

  function openApple() { openInAppleMaps(rec.name, { lat: rec.latitude, lng: rec.longitude }); }
  function openGoogle() { openInGoogleMaps(rec.name, { lat: rec.latitude, lng: rec.longitude, placeId: rec.google_place_id }); }

  function openDetail() {
    void triggerHapticSelection();
    router.push(`/restaurant/${rec.google_place_id}` as any);
  }

  return (
    <View style={[styles.row, stack && styles.rowStacked]}>
      {/* The row body is the tap target — StretchPick has always opened place
          detail on tap and this card did not, which read as a dead card. */}
      <TapCard
        style={{ flex: 1 }}
        onPress={openDetail}
        accessibilityRole="button"
        accessibilityLabel={`${rec.name}. Open place details.`}
      >
        <View style={[styles.nameRow, stack && styles.nameRowStacked]}>
          {/* numberOfLines lifts with scale — two lines at 100% is generous,
              at 235% it is a truncated word. */}
          <Text style={styles.name} numberOfLines={stack ? 4 : 2}>{rec.name}</Text>
          {rec.matchScore != null && (
            <View style={[
              styles.matchBadge,
              {
                backgroundColor: matchScoreTint(rec.matchScore),
                borderColor: matchScoreColor(rec.matchScore),
              },
            ]}>
              <AnimatedNumber
                value={rec.matchScore}
                suffix="% match"
                duration={650}
                style={[styles.matchBadgeText, { color: matchScoreColor(rec.matchScore) }]}
                maxFontSizeMultiplier={FONT_CAP.badge}
              />
            </View>
          )}
        </View>
        <Text style={styles.sub}>
          {[
            rec.cuisine ? capitalize(rec.cuisine) : null,
            rec.distanceKm != null ? formatDistance(rec.distanceKm) : null,
          ].filter(Boolean).join(" · ") || "Nearby"}
        </Text>
        <View style={styles.mapsRow}>
          {/* Nested pressables stop propagation so Maps never opens detail. */}
          <Pressable
            onPress={(e) => { e.stopPropagation(); openApple(); }}
            style={styles.mapsBtn}
            accessibilityRole="button"
          >
            <Text style={styles.mapsBtnText} maxFontSizeMultiplier={FONT_CAP.chrome}>Apple Maps</Text>
          </Pressable>
          <Pressable
            onPress={(e) => { e.stopPropagation(); openGoogle(); }}
            style={styles.mapsBtn}
            accessibilityRole="button"
          >
            <Text style={styles.mapsBtnText} maxFontSizeMultiplier={FONT_CAP.chrome}>Google Maps</Text>
          </Pressable>
        </View>
      </TapCard>
      <View>
        <Pressable
          onPress={(e) => { e.stopPropagation(); save(); }}
          style={[styles.saveBtn, saved && styles.saveBtnDone]}
          accessibilityRole="button"
        >
          <Text style={[styles.saveText, saved && styles.saveTextDone]} maxFontSizeMultiplier={FONT_CAP.chrome}>
            {saving ? "…" : saved ? "Saved" : "Save"}
          </Text>
        </Pressable>
        <SaveBurst fire={burstKey} />
      </View>
    </View>
  );
}

/**
 * Heuristic auto-tagging when a user saves a recommendation. The persona engine
 * already tells us why a place was picked via `rec.reason` ("Stretch:" prefix
 * = adventurous; cuisine + price hints fill in the rest). Saves the user from
 * manually tagging every save while still seeding the Aspirational Palate.
 */
function inferAspirationTags(rec: RestaurantRecommendation): AspirationTag[] {
  const tags = new Set<AspirationTag>();
  const reason = (rec.reason ?? "").toLowerCase();
  const cuisine = rec.cuisine ?? "";

  if (reason.includes("stretch") || reason.includes("level up")) tags.add("adventurous");
  if (rec.price_level != null && rec.price_level >= 3) {
    tags.add("upscale");
    tags.add("date_night");
  }
  if (cuisine === "healthy") tags.add("healthy");
  if (cuisine === "japanese" || cuisine === "korean" || cuisine === "vietnamese" || cuisine === "thai") {
    tags.add("cultural");
  }
  return [...tags];
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
}

const styles = StyleSheet.create({
  rowStacked: { flexDirection: "column", alignItems: "stretch", gap: 10 },
  nameRowStacked: { flexDirection: "column", alignItems: "flex-start", gap: 6 },
  moodNote: { fontSize: 12, color: colors.mute, marginTop: 10, lineHeight: 17 },
  moodHead: { ...type.micro, marginTop: 4 },
  card: {
    // No top margin — the parent section header controls spacing now.
    padding: card.padding,
    borderRadius: card.radius,
    backgroundColor: colors.faint,
    ...shadow.card,
  },
  head: { flexDirection: "row" },
  eyebrow: { ...type.micro },
  title: { fontSize: 18, fontWeight: "700", color: colors.ink, marginTop: 6, letterSpacing: -0.3 },
  blurb: { ...type.small, marginTop: 4 },
  earlyBadge: {
    marginTop: 8, alignSelf: "flex-start",
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  earlyBadgeText: { fontSize: 10, fontWeight: "700", color: colors.mute, letterSpacing: 0.5 },
  emptyCard: { backgroundColor: colors.faint, borderColor: colors.line },
  emptyText: { ...type.small },
  emptyState: { alignItems: "center", paddingVertical: spacing.lg, gap: 6 },
  emptyGlyph: { fontSize: 22, color: colors.line },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    gap: 12,
  },
  nameRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.ink },
  matchBadge: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.redTint,
    borderWidth: 1, borderColor: colors.redTintBorder,
  },
  matchBadgeText: { fontSize: 11, fontWeight: "800", color: colors.red },
  sub: { ...type.small, marginTop: 2 },
  reason: { fontSize: 13, color: colors.mute, marginTop: 6, fontStyle: "italic", lineHeight: 18 },

  mapsRow: { flexDirection: "row", gap: 6, marginTop: 10 },
  mapsBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  mapsBtnText: { fontSize: 11, fontWeight: "700", color: colors.ink },

  saveBtn: {
    paddingHorizontal: 14, height: 32, borderRadius: 16,
    backgroundColor: colors.red,
    alignItems: "center", justifyContent: "center",
  },
  saveBtnDone: {
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  saveText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  saveTextDone: { color: colors.mute },
});
