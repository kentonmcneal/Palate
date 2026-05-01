import { useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import type { RankedRestaurant } from "../lib/restaurant-ranking";
import { addToWishlist } from "../lib/palate-insights";
import { triggerHapticSuccess, triggerHapticSelection } from "../lib/haptics";
import { pickSaveCopy } from "../lib/save-copy";
import { openInAppleMaps, openInGoogleMaps } from "../lib/maps";
import { trackRecEvent, type RecEventContext } from "../lib/recommendation-events";
import { formatDistance } from "../lib/match-score";

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
  const m = restaurant.match;

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
      const c = pickSaveCopy();
      setTimeout(() => Alert.alert(c.title, c.body), 200);
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
    <Pressable onPress={openDetail} style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={2}>{restaurant.name}</Text>
          <Text style={styles.sub}>{subline || "Nearby"}</Text>
        </View>
        <View style={styles.scoreCol}>
          <Text style={styles.scoreNum}>{m.score}</Text>
          <Text style={styles.scoreLabel}>match</Text>
          {m.confidence === "low" && (
            <Text style={styles.confLow}>early read</Text>
          )}
        </View>
      </View>

      {m.reasons[0] && (
        <Text style={styles.reason}>"{m.reasons[0]}"</Text>
      )}

      {m.reasons.length > 1 && (
        <View style={styles.tagRow}>
          {m.matchedSignals.slice(0, 3).map((s) => (
            <View key={s} style={styles.tag}>
              <Text style={styles.tagText}>{humanize(s)}</Text>
            </View>
          ))}
        </View>
      )}

      {restaurant.rating != null && (
        <Text style={styles.rating}>
          ★ {restaurant.rating.toFixed(1)}
          {restaurant.user_rating_count ? ` · ${formatCount(restaurant.user_rating_count)} reviews` : ""}
        </Text>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={(e) => { e.stopPropagation(); save(); }}
          disabled={saved}
          style={[styles.btnPrimary, saved && styles.btnDone]}
        >
          <Text style={[styles.btnPrimaryText, saved && styles.btnDoneText]}>
            {saving ? "…" : saved ? "Saved" : "Save"}
          </Text>
        </Pressable>
        <Pressable
          onPress={(e) => { e.stopPropagation(); openInAppleMaps(restaurant.name, restaurant.neighborhood); }}
          style={styles.btnGhost}
        >
          <Text style={styles.btnGhostText}>Apple</Text>
        </Pressable>
        <Pressable
          onPress={(e) => { e.stopPropagation(); openInGoogleMaps(restaurant.name, restaurant.neighborhood); }}
          style={styles.btnGhost}
        >
          <Text style={styles.btnGhostText}>Google</Text>
        </Pressable>
        <Pressable
          onPress={(e) => { e.stopPropagation(); dismiss(); }}
          style={styles.btnSubtle}
        >
          <Text style={styles.btnSubtleText}>Not for me</Text>
        </Pressable>
      </View>
    </Pressable>
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
