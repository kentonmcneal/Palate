import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from "react-native";
import { colors, spacing, type } from "../theme";
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
import { assembleGraph, getCompatibility } from "../lib/recommendation";
import { triggerHapticSuccess } from "../lib/haptics";
import { pickSaveCopy } from "../lib/save-copy";
import { openInAppleMaps, openInGoogleMaps } from "../lib/maps";
import { matchScoreColor, matchScoreTint } from "../lib/match-score";
import { AnimatedNumber } from "./AnimatedNumber";
import { SaveBurst } from "./SaveBurst";

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

export function RecommendationsCard() {
  const [recs, setRecs] = useState<RestaurantRecommendation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [earlyEstimate, setEarlyEstimate] = useState(false);
  const [browsingCity] = useBrowsingCity();

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
      const nearby = await nearbyRestaurants(here.lat, here.lng, 3000);
      const graph = assembleGraph(vector, personal);

      // Visited place IDs — used for anti-staleness on the recs feed. We
      // don't want Home to keep recommending places you've already been to
      // many times. (Personal signal already tracks visit counts.)
      const visitedHeavy = new Set<string>();
      for (const [placeId, n] of personal?.visitsByPlaceId.entries() ?? []) {
        if (n >= 3) visitedHeavy.add(placeId);
      }

      const enriched: RestaurantRecommendation[] = nearby
        .filter((p) => !visitedHeavy.has(p.google_place_id))
        .map((p) => {
          const compat = getCompatibility(graph, {
            google_place_id: p.google_place_id,
            name: p.name,
            cuisine_type: p.cuisine_type ?? null,
            cuisine_region: (p as any).cuisine_region ?? null,
            cuisine_subregion: (p as any).cuisine_subregion ?? null,
            format_class: (p as any).format_class ?? null,
            occasion_tags: (p as any).occasion_tags ?? null,
            flavor_tags: (p as any).flavor_tags ?? null,
            cultural_context: (p as any).cultural_context ?? null,
            neighborhood: p.neighborhood ?? null,
            price_level: p.price_level ?? null,
            rating: p.rating ?? null,
            user_rating_count: (p as any).user_rating_count ?? null,
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
            neighborhood: p.neighborhood ?? null,
            price_level: p.price_level ?? null,
            latitude: p.latitude ?? null,
            longitude: p.longitude ?? null,
            rating: p.rating ?? null,
            matchScore: compat.score,
            distanceKm: dKm,
            reason: compat.reasons[0] ?? "Nearby and worth a try.",
          } as RestaurantRecommendation;
        });

      // Sort by canonical compatibility (high → low) and take top 3.
      enriched.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
      setRecs(enriched.slice(0, 3));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, browsingCity?.id]);

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
        <Text style={styles.emptyText}>
          No nearby spots loaded yet. Step outside or pick a city above to browse.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>MOST COMPATIBLE</Text>
          {earlyEstimate && (
            <View style={styles.earlyBadge}>
              <Text style={styles.earlyBadgeText}>EARLY ESTIMATE · sharper after a few more visits</Text>
            </View>
          )}
        </View>
      </View>
      <View style={{ marginTop: 16 }}>
        {recs.map((rec) => (
          <RecRow key={rec.google_place_id} rec={rec} />
        ))}
      </View>
    </View>
  );
}

function RecRow({ rec }: { rec: RestaurantRecommendation }) {
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

  function openApple() { openInAppleMaps(rec.name, rec.neighborhood); }
  function openGoogle() { openInGoogleMaps(rec.name, rec.neighborhood); }

  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={2}>{rec.name}</Text>
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
              />
            </View>
          )}
        </View>
        <Text style={styles.sub}>
          {[
            rec.cuisine ? capitalize(rec.cuisine) : null,
            rec.neighborhood,
            rec.distanceKm != null ? formatDistance(rec.distanceKm) : null,
          ].filter(Boolean).join(" · ") || "Nearby"}
        </Text>
        <Text style={styles.reason}>{rec.reason}</Text>
        <View style={styles.mapsRow}>
          <Pressable onPress={openApple} style={styles.mapsBtn} accessibilityRole="button">
            <Text style={styles.mapsBtnText}>Apple Maps</Text>
          </Pressable>
          <Pressable onPress={openGoogle} style={styles.mapsBtn} accessibilityRole="button">
            <Text style={styles.mapsBtnText}>Google Maps</Text>
          </Pressable>
        </View>
      </View>
      <View>
        <Pressable
          onPress={save}
          style={[styles.saveBtn, saved && styles.saveBtnDone]}
          accessibilityRole="button"
        >
          <Text style={[styles.saveText, saved && styles.saveTextDone]}>
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
  card: {
    // No top margin — the parent section header controls spacing now.
    padding: spacing.md,
    borderRadius: 22,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
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
  emptyText: { ...type.small, marginTop: 10, lineHeight: 20 },

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
    backgroundColor: "#FFF1EE",
    borderWidth: 1, borderColor: "#FFD7CE",
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
