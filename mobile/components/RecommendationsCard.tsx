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
import { scoreMatch, distanceKm, formatDistance } from "../lib/match-score";
import { getEffectiveLocation, useBrowsingCity } from "../lib/browsing-location";
import { loadPersonalSignal } from "../lib/personal-signal";
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
      const start = isoWeekStart();
      const end = new Date().toISOString().slice(0, 10);
      const [persona, vector, here, personal] = await Promise.all([
        generateWeeklyPalatePersona(start, end),
        computeTasteVector().catch(() => null),
        getEffectiveLocation().catch(() => null),
        loadPersonalSignal().catch(() => null),
      ]);
      if (!persona) {
        setRecs([]);
        return;
      }
      // "Early estimate" = we have <5 visits to read from (the persona engine
      // is leaning heavily on the quiz fallback at this point).
      if (vector && vector.visitCount < 5) setEarlyEstimate(true);
      const result = await getPersonaRecommendations(persona, start, end);
      let all = [...(result.similar ?? [])];
      if (result.stretch) all.push(result.stretch);

      // FALLBACK: when persona engine returns nothing (sparse data, missing
      // tags, etc.), pull straight from nearby restaurants ranked by
      // canonical compatibility. Guarantees the card never silently disappears.
      if (all.length === 0 && here) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { nearbyRestaurants } = require("../lib/places");
          const { assembleGraph, getCompatibility } = require("../lib/recommendation");
          const nearby = await nearbyRestaurants(here.lat, here.lng, 3000);
          const graph = assembleGraph(vector, personal);
          all = nearby
            .map((p: any) => {
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
              return {
                google_place_id: p.google_place_id,
                name: p.name,
                cuisine: p.cuisine_type ?? null,
                neighborhood: p.neighborhood ?? null,
                price_level: p.price_level ?? null,
                latitude: p.latitude ?? null,
                longitude: p.longitude ?? null,
                rating: p.rating ?? null,
                reason: compat.reasons[0] ?? "Nearby and worth a try.",
                _fallbackCompat: compat.score,
              } as any;
            })
            .sort((a: any, b: any) => (b._fallbackCompat ?? 0) - (a._fallbackCompat ?? 0));
        } catch {
          // fallback failed — leave all empty, card will hide gracefully
        }
      }

      // Enrich with canonical match score + distance + best reason.
      const now = new Date();
      const enriched: RestaurantRecommendation[] = all.map((r: any) => {
        let matchScore: number | null = r._fallbackCompat ?? null;
        let reason = r.reason;
        if (vector && matchScore == null) {
          const m = scoreMatch(vector, r, undefined, {
            personal: personal ?? undefined,
            googlePlaceId: r.google_place_id,
            applyStaleness: true,
            now,
          });
          matchScore = m.score;
          if (m.reasons[0]) reason = m.reasons[0];
        }
        let dKm: number | null = null;
        if (here && r.latitude != null && r.longitude != null) {
          dKm = distanceKm({ lat: here.lat, lng: here.lng }, { lat: r.latitude, lng: r.longitude });
        }
        return { ...r, matchScore, distanceKm: dKm, reason };
      });
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
  if (error || !recs || recs.length === 0) return null;

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
