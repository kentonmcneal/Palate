import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { computeTasteVector } from "../lib/taste-vector";
import { nearbyRestaurants } from "../lib/places";
import { getCachedNearby, setCachedNearby } from "../lib/nearby-cache";
import { getEffectiveLocation, useBrowsingCity } from "../lib/browsing-location";
import { loadPersonalSignal } from "../lib/personal-signal";
import { matchScoreColor } from "../lib/match-score";
import { triggerHapticSelection } from "../lib/haptics";
import { assembleGraph, computeRightNow, type RightNowPick, type RightNowStrategy } from "../lib/recommendation";
import { toInput as toCandidateInput } from "../lib/recommendation/candidates";
import { AnimatedNumber } from "./AnimatedNumber";

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

// Try Another cycles through these strategies — each tap feels like the app
// is *thinking*, not shuffling. Order is deliberate: comfort before stretch
// gives the user something familiar before pushing them outside their lane.
const STRATEGY_CYCLE: RightNowStrategy[] = ["best", "closest", "comfort", "stretch", "quality"];

const STRATEGY_BADGE: Record<RightNowStrategy, string | null> = {
  best:    null,
  closest: "Closest pick",
  comfort: "Comfort pick",
  stretch: "Stretch pick",
  quality: "Higher-rated pick",
};

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
  // Tracks every pick the user has dismissed via "Try another" so the next
  // call cycles to the NEXT-best, not the same #2 every time. Resets when
  // the city changes (different pool of candidates).
  const dismissedRef = useRef<Set<string>>(new Set());
  // Strategy cursor — cycles through STRATEGY_CYCLE on each Try-another so
  // the app feels intentional. Resets on city change.
  const strategyIdxRef = useRef<number>(0);
  const [strategyLabel, setStrategyLabel] = useState<string | null>(null);
  // 200ms fade for "Try another" pick swap.
  const fade = useRef(new Animated.Value(1)).current;

  const load = useCallback(async (extraExcludeId?: string, strategy: RightNowStrategy = "best") => {
    try {
      const here = await getEffectiveLocation().catch(() => null);
      if (!here) { setEmpty(true); setLoading(false); return; }

      // Use the shared 5-min nearby cache so RightNowHero + StretchPick
      // (which both run computeRightNow independently) only hit Google
      // Places once per location bucket, not twice.
      let nearby = await getCachedNearby(here.lat, here.lng, RADIUS_M);
      if (!nearby) {
        nearby = await nearbyRestaurants(here.lat, here.lng, RADIUS_M);
        void setCachedNearby(here.lat, here.lng, RADIUS_M, nearby);
      }
      const [vector, personal] = await Promise.all([
        computeTasteVector().catch(() => null),
        loadPersonalSignal().catch(() => null),
      ]);

      // Add the new exclusion (if any) to the running dismissed set
      if (extraExcludeId) dismissedRef.current.add(extraExcludeId);

      const filtered = nearby.filter((r) => !dismissedRef.current.has(r.google_place_id));

      // Canonical pipeline: build graph once, then computeRightNow.
      const graph = assembleGraph(vector, personal);
      const result = await computeRightNow({
        graph,
        here,
        preFetched: filtered.map(toCandidateInput),
        strategy,
      });

      // If "Try another" yielded no alternate, KEEP the current pick on screen
      // per spec — never disappear the card mid-interaction.
      if (extraExcludeId && !result.rightNow) {
        // no-op: leave existing pick + don't flip to empty
      } else {
        setPick(result.rightNow);
        setEmpty(!result.rightNow);
      }
    } catch {
      // For Try-another swaps, keep the current pick instead of going empty.
      if (!extraExcludeId) setEmpty(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
      // Fade the new content back in (200ms).
      Animated.timing(fade, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [fade]);

  // Reset dismissed list + strategy cursor when the user picks a different city.
  useEffect(() => {
    dismissedRef.current.clear();
    strategyIdxRef.current = 0;
    setStrategyLabel(null);
    load();
  }, [load, browsingCity?.id]);

  function tryAnother() {
    void triggerHapticSelection();
    setRefreshing(true);
    // Advance the strategy cursor BEFORE we fade. Each Try-another tap moves
    // to the next strategy in STRATEGY_CYCLE so the user feels intent.
    strategyIdxRef.current = (strategyIdxRef.current + 1) % STRATEGY_CYCLE.length;
    const nextStrategy = STRATEGY_CYCLE[strategyIdxRef.current];
    setStrategyLabel(STRATEGY_BADGE[nextStrategy]);
    // Fade current pick OUT (200ms), then swap in the next one.
    Animated.timing(fade, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      load(pick?.restaurant.google_place_id, nextStrategy);
    });
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
      {/* Glowing score chip in corner — animates 0→score over 600ms when the
          pick changes (first render + every "Try another" swap). */}
      <View style={[styles.scoreChip, { backgroundColor: accent, shadowColor: accent }]}>
        <AnimatedNumber
          key={r.google_place_id}
          value={score}
          from={0}
          duration={600}
          style={styles.scoreText}
        />
      </View>

      <Text style={styles.eyebrow}>WHAT SHOULD I EAT RIGHT NOW</Text>
      {/* Strategy badge — only shown after the user has cycled past "best". */}
      {strategyLabel && (
        <View style={styles.strategyBadge}>
          <Text style={styles.strategyBadgeText}>{strategyLabel.toUpperCase()}</Text>
        </View>
      )}
      {/* Body fades during Try-another swap; score chip + eyebrow stay put. */}
      <Animated.View style={{ opacity: fade }}>
        <Text style={styles.name} numberOfLines={2}>{r.name}</Text>
        {sub.length > 0 && <Text style={styles.sub}>{sub}</Text>}

        <View style={styles.divider} />

        <Text style={styles.reason}>{trimReason(pick.explanation.primary)}</Text>
        <Text style={styles.status}>{pick.explanation.secondary}</Text>
      </Animated.View>

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

/** Per design patch: reason line is capped at 12 words. Trims at a word
 *  boundary and re-adds a period if we cut mid-sentence. */
function trimReason(raw: string): string {
  if (!raw) return raw;
  const words = raw.trim().split(/\s+/);
  if (words.length <= 12) return raw;
  const trimmed = words.slice(0, 12).join(" ").replace(/[,;:—-]+$/, "");
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
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
    width: 60, height: 60, borderRadius: 30,
    alignItems: "center", justifyContent: "center",
    // Restrained glow per redesign brief — score chip should NOT outshout
    // the restaurant name. Was opacity 1 / radius 22.
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.95)",
    elevation: 6,
  },
  scoreText: {
    color: "#fff", fontWeight: "800", fontSize: 20, letterSpacing: -0.5,
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },

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
    // Subtle brand glow — restrained per redesign brief (was 0.7 → 0.32).
    shadowColor: colors.red,
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
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

  strategyBadge: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  strategyBadgeText: {
    color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 1.4,
  },
});
