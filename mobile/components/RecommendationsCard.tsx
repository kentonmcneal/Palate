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
import { loadPersonalSignal, onPersonalSignalInvalidate } from "../lib/personal-signal";
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
import { LoadError } from "./LoadError";
import { askNotInterested } from "./notInterested";

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
    dish_family: p.dish_family ?? null,
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
      setError(false);
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
      const hidden = personal?.dislikes.placeIds ?? null;
      const enriched: RestaurantRecommendation[] = filterRecommendable(nearby, { hidden })
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

  // "Not interested" from a row: gone from this list now, and from every
  // surface on the next load (the signal cache was invalidated).
  // Ids hidden this session, so the catalogue fallback (which re-fetches
  // when allRecs changes) cannot bring a just-hidden row straight back
  // before the signal cache has reloaded.
  const hiddenRef = useRef(new Set<string>());
  function hidePlace(placeId: string) {
    hiddenRef.current.add(placeId);
    setAllRecs((cur) => (cur ? cur.filter((r) => r.google_place_id !== placeId) : cur));
    setRecs((cur) => (cur ? cur.filter((r) => r.google_place_id !== placeId) : cur));
  }
  // Reload when the personal signal changes: a visit logged, a place hidden
  // or restored anywhere in the app. Home's own focus reload did not reach
  // this component.
  useEffect(() => onPersonalSignalInvalidate(() => { void load(); }), [load]);

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
    // Top up from the catalogue whenever the pool cannot fill the three slots
    // — not only when it matches nothing. A cuisine with one place nearby used
    // to show one card and look broken; there are usually a dozen more within
    // reach that the 3km Google fetch never saw.
    const isCatalogueMood = typeof mood === "string" && !isIntentMood(mood) && !isSurprise(mood);
    const wantsCatalogue = isCatalogueMood && (!matched || items.length < 3);

    if (wantsCatalogue && scoringRef.current) {
      const { graph, here, personal } = scoringRef.current;
      setCatalogueLoading(true);
      const fetchCandidates = isDishMood(mood)
        ? dishCandidates(here, dishOf(mood) ?? "")
        : cuisineCandidates(here, String(mood));
      void fetchCandidates
        .then((rows) => {
          if (!alive) return;
          // The pool's own matches keep their place at the front — they are
          // closer and already scored — and the catalogue fills in behind.
          const poolIds = new Set((matched ? items : []).map((r) => r.google_place_id));
          const scored = [
            ...(matched ? items : []),
            ...rows
              .filter((r) => !poolIds.has(r.google_place_id))
              .filter((r) => !personal?.dislikes?.placeIds.has(r.google_place_id) && !hiddenRef.current.has(r.google_place_id))
              .map((r) => toRecommendation(r, graph, here, personal))
              .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0)),
          ];
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
          // Saying nothing here shows the same three places as "Anything",
          // which is indistinguishable from a chip that does nothing.
          setRecs(items.slice(0, 3));
          setMoodCount(null);
          setMoodNote(`Couldn't reach ${moodLabel(mood)} nearby. These are the regular picks.`);
        })
        .finally(() => { if (alive) setCatalogueLoading(false); });
      return () => { alive = false; };
    }

    setRecs(items.slice(0, 3));
    setMoodCount(mood ? (matched ? items.length : 0) : null);
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
  // Home's main retention surface used to vanish on any throw and never come
  // back (error was never reset). It says so and offers Retry now.
  if (error && (!recs || recs.length === 0)) {
    return <LoadError error={new Error("recommendations failed")} onRetry={() => { setError(false); setLoading(true); void load(); }} />;
  }
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
      {typeof mood === "string" && (
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
          <RecRow key={rec.google_place_id} rec={rec} onHide={() => hidePlace(rec.google_place_id)} />
        ))}
      </View>
    </View>
  );
}

function RecRow({ rec, onHide }: { rec: RestaurantRecommendation; onHide: () => void }) {
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
    <View style={styles.row}>
      {/* The name gets the full width. It used to share the line with the
          match badge AND a stacked ✕/Save column, which squeezed it to about
          half the screen: "Huey's Southwind" wrapped to two lines and "Waffle
          Mania winners" truncated mid-word. Actions moved to their own row. */}
      <TapCard
        onPress={openDetail}
        accessibilityRole="button"
        accessibilityLabel={`${rec.name}. Open place details.`}
      >
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={stack ? 4 : 2}>{rec.name}</Text>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              askNotInterested({ google_place_id: rec.google_place_id, name: rec.name }, { surface: "home_recs", onDone: onHide });
            }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`Not interested in ${rec.name}`}
            style={styles.hideBtn}
          >
            <Text style={styles.hideText}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.metaRow}>
          {rec.matchScore != null && (
            <View style={[
              styles.matchBadge,
              { backgroundColor: matchScoreTint(rec.matchScore), borderColor: matchScoreColor(rec.matchScore) },
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
          <Text style={styles.sub} numberOfLines={1}>
            {[
              rec.cuisine ? capitalize(rec.cuisine) : null,
              rec.distanceKm != null ? formatDistance(rec.distanceKm) : null,
            ].filter(Boolean).join(" · ") || "Nearby"}
          </Text>
        </View>

        <View style={[styles.actionRow, stack && styles.actionRowStacked]}>
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
          <View style={{ flex: 1 }} />
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
      </TapCard>
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
    paddingVertical: 14,
    borderTopColor: colors.line,
    borderTopWidth: 1,
  },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  actionRowStacked: { flexDirection: "column", alignItems: "stretch", gap: 8 },
  name: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.ink, letterSpacing: -0.3 },
  matchBadge: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.redTint,
    borderWidth: 1, borderColor: colors.redTintBorder,
  },
  matchBadgeText: { fontSize: 11, fontWeight: "800", color: colors.red },
  sub: { ...type.small, flexShrink: 1 },
  reason: { fontSize: 13, color: colors.mute, marginTop: 6, fontStyle: "italic", lineHeight: 18 },

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
  hideBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line },
  hideText: { fontSize: 12, fontWeight: "800", color: colors.mute },
  saveTextDone: { color: colors.mute },
});
