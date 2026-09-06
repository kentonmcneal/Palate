import { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Text } from "./Text";
import { useRouter } from "expo-router";
import { trackRecEvent, trackImpression, rememberRecTouch, type RecEventContext } from "../lib/recommendation-events";
import { Impression } from "./Impressions";
import { colors, spacing, type, card, shadow, categoryColors } from "../theme";
import { computeTasteVector } from "../lib/taste-vector";
import { nearbyRestaurants } from "../lib/places";
import { getCachedNearby, setCachedNearby } from "../lib/nearby-cache";
import { getEffectiveLocation, useBrowsingCity } from "../lib/browsing-location";
import { loadPersonalSignal, onPersonalSignalInvalidate } from "../lib/personal-signal";
import { matchScoreColor, matchScoreTint } from "../lib/match-score";
import { assembleGraph, computeRightNow, type RightNowPick as StretchPickType } from "../lib/recommendation";
import { toInput as toCandidateInput } from "../lib/recommendation/candidates";
import { filterRecommendable } from "../lib/recommendation/eligibility";
import { cuisineHue, PlaceTile } from "./PlaceArt";
import { FONT_CAP } from "../lib/a11y";

// ============================================================================
// StretchPick — one recommendation slightly outside the user's pattern.
// Lighter visual weight than the Right Now hero, but still a single decisive
// pick, not a list. The "stretch" framing is explicit.
// ============================================================================

const RADIUS_M = 2500;

export function StretchPick() {
  const router = useRouter();
  const [browsingCity] = useBrowsingCity();
  const [pick, setPick] = useState<StretchPickType | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const here = await getEffectiveLocation().catch(() => null);
      if (!here) return;
      // Share the nearby cache with RightNowHero — they both fetch the same
      // bucket, so one Google call covers both components.
      let nearby = await getCachedNearby(here.lat, here.lng, RADIUS_M);
      if (!nearby) {
        nearby = await nearbyRestaurants(here.lat, here.lng, RADIUS_M);
        void setCachedNearby(here.lat, here.lng, RADIUS_M, nearby);
      }
      const [vector, personal] = await Promise.all([
        computeTasteVector().catch(() => null),
        loadPersonalSignal().catch(() => null),
      ]);
      const graph = assembleGraph(vector, personal);
      const result = await computeRightNow({
        graph,
        here,
        // One gate for every surface (lib/recommendation/eligibility.ts). The
        // old `eligibility > 0` check let unclassified chains through — this
        // slot is where Domino's Pizza surfaced at 31% match.
        preFetched: filterRecommendable(nearby.map(toCandidateInput), { hidden: personal?.dislikes.placeIds ?? null }),
      });
      setPick(result.stretch);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, browsingCity?.id]);
  useEffect(() => onPersonalSignalInvalidate(() => { void load(); }), [load]);

  if (loading) return null;
  if (!pick?.restaurant?.match) return null;

  const r = pick.restaurant;
  const score = r.match?.score ?? 0;
  const stretchCtx: RecEventContext = {
    surface: "discover_for_you", bucket: "stretch", slot: "explore",
    matchScore: score, finalScore: r.score?.finalScore,
  };
  // The same hue this place wears on every other card, so the pick is
  // recognisably the same restaurant if it also appears in the list above.
  const hue = cuisineHue(r.cuisine_type, r.google_place_id);
  const sub = r.cuisine_type ? cap(r.cuisine_type) : "";

  return (
    <Impression id={r.google_place_id} surface="discover_for_you" onSeen={() => trackImpression(r.google_place_id, stretchCtx)}>
    <Pressable
      style={styles.card}
      onPress={() => {
        rememberRecTouch(r.google_place_id, stretchCtx);
        void trackRecEvent("stretch_pick_clicked", r.google_place_id, stretchCtx);
        router.push(`/restaurant/${r.google_place_id}` as any);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${r.name}. Open place details.`}
    >
    {/* Shadow on the outer view, clipping on the inner one: iOS drops a
        view's own shadow when that view clips its children, so one view
        cannot both cast the card shadow and cut the rail to the corners. */}
    <View style={styles.cardClip}>
      {/* The rail every recommendation card wears, in this place's own
          cuisine hue, so the pick reads as one more place rather than as a
          banner about one. */}
      <View style={[styles.rail, { backgroundColor: hue }]} />
      <View style={styles.head}>
        <Text style={styles.eyebrow} maxFontSizeMultiplier={FONT_CAP.eyebrow}>ONE PLACE TO STRETCH YOUR PALATE</Text>
        <View style={[styles.scoreChip, { backgroundColor: matchScoreTint(score), borderColor: matchScoreColor(score) }]}>
          <Text style={[styles.scoreText, { color: matchScoreColor(score) }]}>{score}</Text>
        </View>
      </View>
      {/* The same tile the list cards carry, so the stretch pick reads as
          one more place and not as an advertisement for one. */}
      <View style={styles.nameRow}>
        <PlaceTile seed={r.google_place_id} name={r.name} cuisine={r.cuisine_type} size={48} style={styles.tile} />
        <Text style={[styles.name, { flex: 1 }]} numberOfLines={2}>{r.name}</Text>
      </View>
      {/* Star in saffron, cuisine in its hue: the same subline grammar as the
          list cards, so the eye does not have to learn a second one here. */}
      {(r.rating != null || sub.length > 0) && (
        <Text style={styles.sub}>
          {r.rating != null && <Text style={styles.star}>★ {r.rating.toFixed(1)}</Text>}
          {r.rating != null && sub.length > 0 && " · "}
          {sub.length > 0 && <Text style={[styles.cuisineText, { color: hue }]}>{sub}</Text>}
        </Text>
      )}
      <Text style={styles.status}>{pick.explanation.secondary}</Text>
    </View>
    </Pressable>
    </Impression>
  );
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: card.radius,
    backgroundColor: colors.faint,
    ...shadow.card,
  },
  // Clips the rail to the rounded corner. Padding lives here so the rail can
  // run the card's full height at its edge.
  cardClip: {
    borderRadius: card.radius,
    overflow: "hidden",
    padding: spacing.md,
  },
  nameRow: { flexDirection: "row", alignItems: "center" },
  tile: { marginRight: 12 },
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  // Pine is the colour of "outside your pattern" across the app: Home's
  // SOMETHING DIFFERENT eyebrow and the Somewhere new chip wear it too.
  eyebrow: { ...type.micro, color: categoryColors.pine },
  scoreChip: {
    minWidth: 38, height: 26, borderRadius: 13,
    paddingHorizontal: 8,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1,
  },
  scoreText: { fontSize: 13, fontWeight: "800" },

  name: { fontSize: 20, fontWeight: "800", color: colors.ink, letterSpacing: -0.4, marginTop: 8, lineHeight: 24 },
  sub: { ...type.small, marginTop: 2 },
  star: { color: categoryColors.saffron, fontWeight: "700" },
  cuisineText: { fontWeight: "700" },

  reasonRow: { marginTop: 10 },
  reason: { fontSize: 13, color: colors.ink, fontWeight: "600", lineHeight: 20 },
  status: { fontSize: 13, color: colors.mute, marginTop: 6, fontWeight: "700", letterSpacing: 0.2 },
});
