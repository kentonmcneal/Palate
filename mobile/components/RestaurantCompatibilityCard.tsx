import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert, Animated, Easing } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import type { RankedRestaurant } from "../lib/restaurant-ranking";
import { addToWishlist } from "../lib/palate-insights";
import { triggerHapticSuccess, triggerHapticSelection } from "../lib/haptics";
import { pickSaveCopy } from "../lib/save-copy";
import { openInAppleMaps, openInGoogleMaps } from "../lib/maps";
import { trackRecEvent, type RecEventContext } from "../lib/recommendation-events";
import { formatDistance } from "../lib/match-score";
import { AnimatedNumber } from "./AnimatedNumber";
import { SaveBurst } from "./SaveBurst";
import { TapCard } from "./TapCard";

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
};

export function RestaurantCompatibilityCard({ restaurant, surface, bucket, onDismissed }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [burstKey, setBurstKey] = useState(0);
  const m = restaurant.match;

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
    void trackRecEvent("restaurant_clicked", restaurant.google_place_id, {
      surface, bucket, matchScore: m.score,
    });
    if (bucket === "stretch") {
      void trackRecEvent("stretch_pick_clicked", restaurant.google_place_id, {
        surface, bucket, matchScore: m.score,
      });
    }
    router.push(`/restaurant/${restaurant.google_place_id}` as any);
  }

  async function save() {
    if (saved || saving) return;
    setSaving(true);
    try {
      await addToWishlist(restaurant.google_place_id, { source: "recommendation" });
      void triggerHapticSuccess();
      void trackRecEvent("restaurant_saved", restaurant.google_place_id, {
        surface, bucket, matchScore: m.score,
      });
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

  function dismiss() {
    void triggerHapticSelection();
    void trackRecEvent("recommendation_dismissed", restaurant.google_place_id, {
      surface, bucket, matchScore: m.score,
    });
    setDismissed(true);
    onDismissed?.();
  }

  const subline = [
    restaurant.cuisine_type ? cap(restaurant.cuisine_type) : null,
    restaurant.neighborhood,
    restaurant.distanceKm != null ? formatDistance(restaurant.distanceKm) : null,
  ].filter(Boolean).join(" · ");

  return (
    <Animated.View style={enterStyle}>
    <TapCard onPress={openDetail} style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={2}>{restaurant.name}</Text>
          <Text style={styles.sub}>{subline || "Nearby"}</Text>
        </View>
        <View style={styles.scoreCol}>
          <AnimatedNumber value={m.score} duration={750} style={styles.scoreNum} />
          <Text style={styles.scoreLabel}>match</Text>
          {m.confidence === "low" && (
            <Text style={styles.confLow}>early read</Text>
          )}
        </View>
      </View>

      {m.reasons[0] && (
        <Text style={styles.reason}>{m.reasons[0]}</Text>
      )}

      <View style={styles.actions}>
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
          onPress={(e) => { e.stopPropagation(); openInAppleMaps(restaurant.name, restaurant.neighborhood); }}
          onLongPress={(e) => { e.stopPropagation(); openInGoogleMaps(restaurant.name, restaurant.neighborhood); }}
          style={styles.btnGhost}
        >
          <Text style={styles.btnGhostText}>Maps</Text>
        </Pressable>
        <Pressable
          onPress={(e) => { e.stopPropagation(); dismiss(); }}
          style={styles.btnSubtle}
          hitSlop={8}
        >
          <Text style={styles.btnSubtleText}>Pass</Text>
        </Pressable>
      </View>
    </TapCard>
    </Animated.View>
  );
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 10,
  },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  name: { fontSize: 17, fontWeight: "800", color: colors.ink, letterSpacing: -0.2 },
  sub: { ...type.small, marginTop: 4 },
  scoreCol: { alignItems: "center", minWidth: 56 },
  scoreNum: { fontSize: 24, fontWeight: "800", color: colors.red, letterSpacing: -0.5 },
  scoreLabel: { fontSize: 10, fontWeight: "700", color: colors.mute, letterSpacing: 1 },
  confLow: { fontSize: 9, fontWeight: "700", color: colors.mute, marginTop: 4 },

  reason: { marginTop: 10, fontSize: 14, color: colors.ink, fontStyle: "italic", lineHeight: 20 },

  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  tag: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  tagText: { fontSize: 10, fontWeight: "700", color: colors.ink },

  rating: { fontSize: 12, color: colors.mute, marginTop: 8, fontWeight: "600" },

  actions: { marginTop: 12, flexDirection: "row", gap: 6, flexWrap: "wrap" },
  btnPrimary: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.red,
  },
  btnPrimaryText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  btnDone: { backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line },
  btnDoneText: { color: colors.mute },
  btnGhost: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  btnGhostText: { fontSize: 12, fontWeight: "700", color: colors.ink },
  btnSubtle: { paddingHorizontal: 10, paddingVertical: 8, marginLeft: "auto" },
  btnSubtleText: { fontSize: 11, fontWeight: "600", color: colors.mute },
});
