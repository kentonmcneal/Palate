import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { computeTasteVector } from "../lib/taste-vector";
import { nearbyRestaurants } from "../lib/places";
import { getEffectiveLocation, useBrowsingCity } from "../lib/browsing-location";
import { loadPersonalSignal } from "../lib/personal-signal";
import { matchScoreColor } from "../lib/match-score";
import { triggerHapticSelection } from "../lib/haptics";
import { assembleGraph, computeRightNow, type RightNowPick } from "../lib/recommendation";
import { toInput as toCandidateInput } from "../lib/recommendation/candidates";

// ============================================================================
// RightNowHero — the dominant decision card on Home.
// ----------------------------------------------------------------------------
// One restaurant. Big. Decisive. Always shows:
//   - score (color-coded)
//   - name + cuisine + neighborhood
//   - one-line behavioral explanation
//   - status line (distance · % match)
//   - "Take me there" primary CTA + "Try another" refresh
// The point is to remove the decision, not list options.
// ============================================================================

const RADIUS_M = 2500;

type Props = {
  onTakeMeThere?: (placeId: string) => void;
};

export function RightNowHero({ onTakeMeThere }: Props) {
  const router = useRouter();
  const [browsingCity] = useBrowsingCity();
  const [pick, setPick] = useState<RightNowPick | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [empty, setEmpty] = useState(false);

  const load = useCallback(async (excludeIds: string[] = []) => {
    try {
      const here = await getEffectiveLocation().catch(() => null);
      if (!here) { setEmpty(true); setLoading(false); return; }

      const [nearby, vector, personal] = await Promise.all([
        nearbyRestaurants(here.lat, here.lng, RADIUS_M),
        computeTasteVector().catch(() => null),
        loadPersonalSignal().catch(() => null),
      ]);

      const filtered = excludeIds.length > 0
        ? nearby.filter((r) => !excludeIds.includes(r.google_place_id))
        : nearby;

      // Canonical pipeline: build graph once, then computeRightNow.
      const graph = assembleGraph(vector, personal);
      const result = await computeRightNow({
        graph,
        here,
        preFetched: filtered.map(toCandidateInput),
      });

      setPick(result.rightNow);
      setEmpty(!result.rightNow);
    } catch {
      setEmpty(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, browsingCity?.id]);

  function tryAnother() {
    void triggerHapticSelection();
    setRefreshing(true);
    load(pick ? [pick.restaurant.google_place_id] : []);
  }

  function takeMeThere() {
    if (!pick) return;
    void triggerHapticSelection();
    if (onTakeMeThere) onTakeMeThere(pick.restaurant.google_place_id);
    else router.push(`/restaurant/${pick.restaurant.google_place_id}` as any);
  }

  if (loading) {
    return (
      <View style={[styles.card, styles.cardLoading]}>
        <Text style={styles.eyebrow}>WHAT SHOULD I EAT RIGHT NOW</Text>
        <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
      </View>
    );
  }

  if (empty || !pick) {
    return (
      <View style={[styles.card, styles.cardEmpty]}>
        <Text style={styles.eyebrow}>WHAT SHOULD I EAT RIGHT NOW</Text>
        <Text style={styles.emptyTitle}>Not enough nearby spots yet.</Text>
        <Text style={styles.emptySub}>
          Pick a city above to browse, or step outside and try again.
        </Text>
      </View>
    );
  }

  const r = pick.restaurant;
  const score = r.match.score;
  const sub = [r.cuisine_type ? cap(r.cuisine_type) : null, r.neighborhood].filter(Boolean).join(" · ");
  const accent = matchScoreColor(score);

  return (
    <View style={styles.card}>
      <LinearGradient
        colors={["#1A1A1A", "#0E0E0E"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Glowing score chip in corner */}
      <View style={[styles.scoreChip, { backgroundColor: accent, shadowColor: accent }]}>
        <Text style={styles.scoreText}>{score}</Text>
      </View>

      <Text style={styles.eyebrow}>WHAT SHOULD I EAT RIGHT NOW</Text>
      <Text style={styles.name} numberOfLines={2}>{r.name}</Text>
      {sub.length > 0 && <Text style={styles.sub}>{sub}</Text>}

      <View style={styles.divider} />

      <Text style={styles.reason}>{pick.explanation.primary}</Text>
      <Text style={styles.status}>{pick.explanation.secondary}</Text>

      <View style={styles.actions}>
        <Pressable onPress={takeMeThere} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Take me there →</Text>
        </Pressable>
        <Pressable onPress={tryAnother} style={styles.ghostBtn} disabled={refreshing}>
          <Text style={styles.ghostBtnText}>{refreshing ? "…" : "Try another"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: 24,
    backgroundColor: colors.ink,
    overflow: "hidden",
    minHeight: 260,
  },
  cardLoading: {
    backgroundColor: colors.ink,
    minHeight: 220,
  },
  cardEmpty: {
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 30 },

  scoreChip: {
    position: "absolute",
    top: 16, right: 16,
    width: 56, height: 56, borderRadius: 28,
    alignItems: "center", justifyContent: "center",
    shadowOpacity: 0.7,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.95)",
  },
  scoreText: { color: "#fff", fontWeight: "800", fontSize: 18, letterSpacing: -0.5 },

  eyebrow: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11, fontWeight: "700", letterSpacing: 1.5,
    marginBottom: 8,
  },
  name: {
    color: "#fff",
    fontSize: 28, fontWeight: "800", letterSpacing: -0.6,
    lineHeight: 32,
    paddingRight: 70,  // leave room for score chip
  },
  sub: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14, fontWeight: "600",
    marginTop: 6,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.14)",
    marginVertical: 16,
  },
  reason: {
    color: "#fff",
    fontSize: 16, fontWeight: "700", lineHeight: 22,
  },
  status: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12, fontWeight: "700",
    marginTop: 6,
    letterSpacing: 0.3,
  },

  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  primaryBtn: {
    flex: 1,
    height: 48, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.red,
    shadowColor: colors.red,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 14, letterSpacing: 0.2 },
  ghostBtn: {
    paddingHorizontal: 16, height: 48,
    alignItems: "center", justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  ghostBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  emptyTitle: { fontSize: 17, fontWeight: "800", color: colors.ink, marginTop: 6 },
  emptySub: { fontSize: 13, color: colors.mute, marginTop: 6, lineHeight: 18 },
});
