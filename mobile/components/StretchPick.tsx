import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { computeTasteVector } from "../lib/taste-vector";
import { nearbyRestaurants } from "../lib/places";
import { getEffectiveLocation, useBrowsingCity } from "../lib/browsing-location";
import { loadPersonalSignal } from "../lib/personal-signal";
import { pickRightNowAndStretch, type StretchPick as StretchPickType } from "../lib/right-now";
import { matchScoreColor, matchScoreTint } from "../lib/match-score";

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
      const [nearby, vector, personal] = await Promise.all([
        nearbyRestaurants(here.lat, here.lng, RADIUS_M),
        computeTasteVector().catch(() => null),
        loadPersonalSignal().catch(() => null),
      ]);
      const result = await pickRightNowAndStretch({
        vector,
        candidates: nearby.map((r) => ({
          google_place_id: r.google_place_id,
          name: r.name,
          cuisine_type: r.cuisine_type ?? null,
          cuisine_region: (r as any).cuisine_region ?? null,
          cuisine_subregion: (r as any).cuisine_subregion ?? null,
          format_class: (r as any).format_class ?? null,
          occasion_tags: (r as any).occasion_tags ?? null,
          flavor_tags: (r as any).flavor_tags ?? null,
          cultural_context: (r as any).cultural_context ?? null,
          neighborhood: r.neighborhood ?? null,
          price_level: r.price_level ?? null,
          rating: r.rating ?? null,
          user_rating_count: (r as any).user_rating_count ?? null,
          latitude: r.latitude ?? null,
          longitude: r.longitude ?? null,
        })),
        here,
        personal,
      });
      setPick(result.stretch);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, browsingCity?.id]);

  if (loading) return null;
  if (!pick) return null;

  const r = pick.restaurant;
  const score = r.match.score;
  const sub = [r.cuisine_type ? cap(r.cuisine_type) : null, r.neighborhood].filter(Boolean).join(" · ");

  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push(`/restaurant/${r.google_place_id}` as any)}
    >
      <View style={styles.head}>
        <Text style={styles.eyebrow}>ONE PLACE TO STRETCH YOUR PALATE</Text>
        <View style={[styles.scoreChip, { backgroundColor: matchScoreTint(score), borderColor: matchScoreColor(score) }]}>
          <Text style={[styles.scoreText, { color: matchScoreColor(score) }]}>{score}</Text>
        </View>
      </View>
      <Text style={styles.name} numberOfLines={2}>{r.name}</Text>
      {sub.length > 0 && <Text style={styles.sub}>{sub}</Text>}
      <View style={styles.reasonRow}>
        <Text style={styles.reason}>{pick.explanation.primary}</Text>
      </View>
      <Text style={styles.status}>{pick.explanation.secondary}</Text>
    </Pressable>
  );
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    borderRadius: 20,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  eyebrow: { ...type.micro, color: colors.red },
  scoreChip: {
    minWidth: 38, height: 26, borderRadius: 13,
    paddingHorizontal: 8,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1,
  },
  scoreText: { fontSize: 12, fontWeight: "800" },

  name: { fontSize: 20, fontWeight: "800", color: colors.ink, letterSpacing: -0.4, marginTop: 8, lineHeight: 24 },
  sub: { ...type.small, marginTop: 2 },

  reasonRow: { marginTop: 10 },
  reason: { fontSize: 14, color: colors.ink, fontWeight: "600", lineHeight: 20 },
  status: { fontSize: 12, color: colors.mute, marginTop: 6, fontWeight: "700", letterSpacing: 0.2 },
});
