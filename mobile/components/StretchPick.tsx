import { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Text } from "./Text";
import { useRouter } from "expo-router";
import { colors, spacing, type, card, shadow } from "../theme";
import { computeTasteVector } from "../lib/taste-vector";
import { nearbyRestaurants } from "../lib/places";
import { getCachedNearby, setCachedNearby } from "../lib/nearby-cache";
import { getEffectiveLocation, useBrowsingCity } from "../lib/browsing-location";
import { loadPersonalSignal } from "../lib/personal-signal";
import { matchScoreColor, matchScoreTint } from "../lib/match-score";
import { assembleGraph, computeRightNow, type RightNowPick as StretchPickType } from "../lib/recommendation";
import { toInput as toCandidateInput } from "../lib/recommendation/candidates";
import { filterRecommendable } from "../lib/recommendation/eligibility";

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

  if (loading) return null;
  if (!pick?.restaurant?.match) return null;

  const r = pick.restaurant;
  const score = r.match?.score ?? 0;
  const sub = r.cuisine_type ? cap(r.cuisine_type) : "";

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
    borderRadius: card.radius,
    backgroundColor: colors.faint,
    ...shadow.card,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  eyebrow: { ...type.micro, color: colors.mute },
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
