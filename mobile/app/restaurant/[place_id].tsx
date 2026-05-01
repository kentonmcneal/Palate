import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  Image, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { supabase } from "../../lib/supabase";
import { computeTasteVector } from "../../lib/taste-vector";
import { scoreMatch } from "../../lib/match-score";
import { addToWishlist } from "../../lib/palate-insights";
import { openInAppleMaps, openInGoogleMaps } from "../../lib/maps";
import { triggerHapticSuccess } from "../../lib/haptics";
import { pickSaveCopy } from "../../lib/save-copy";

// ============================================================================
// Restaurant detail — your full history at one place + match score + actions.
// ============================================================================

type RestaurantRow = {
  id: string;
  name: string;
  google_place_id: string;
  address: string | null;
  cuisine_type: string | null;
  cuisine_region: string | null;
  cuisine_subregion: string | null;
  format_class: string | null;
  occasion_tags: string[] | null;
  flavor_tags: string[] | null;
  neighborhood: string | null;
  price_level: number | null;
  rating: number | null;
  user_rating_count: number | null;
};

type VisitRow = {
  id: string;
  visited_at: string;
  meal_type: string;
  notes: string | null;
  photo_url: string | null;
};

export default function RestaurantDetailScreen() {
  const router = useRouter();
  const { place_id } = useLocalSearchParams<{ place_id: string }>();
  const [restaurant, setRestaurant] = useState<RestaurantRow | null>(null);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [matchScore, setMatchScore] = useState<number | null>(null);
  const [matchReasons, setMatchReasons] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [alreadySaved, setAlreadySaved] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      const { data: rest, error: rErr } = await supabase
        .from("restaurants")
        .select("*")
        .eq("google_place_id", place_id)
        .maybeSingle();
      if (rErr || !rest) {
        setLoading(false);
        return;
      }
      const r = rest as RestaurantRow;
      setRestaurant(r);

      const [visitsRes, vector, wishRes] = await Promise.all([
        user ? supabase
          .from("visits")
          .select("id, visited_at, meal_type, notes, photo_url")
          .eq("restaurant_id", r.id)
          .eq("user_id", user.id)
          .order("visited_at", { ascending: false }) : Promise.resolve({ data: [] }),
        computeTasteVector().catch(() => null),
        user ? supabase
          .from("wishlist")
          .select("id")
          .eq("user_id", user.id)
          .eq("restaurant_id", r.id)
          .maybeSingle() : Promise.resolve({ data: null }),
      ]);

      setVisits((visitsRes as any).data ?? []);
      setAlreadySaved(!!(wishRes as any).data);
      if (vector) {
        const m = scoreMatch(vector, {
          cuisine: r.cuisine_type,
          neighborhood: r.neighborhood,
          price_level: r.price_level,
        }, {
          cuisineRegion: r.cuisine_region,
          cuisineSubregion: r.cuisine_subregion,
          formatClass: r.format_class,
          occasionTags: r.occasion_tags,
          flavorTags: r.flavor_tags,
        });
        setMatchScore(m.score);
        setMatchReasons(m.reasons);
      }
    } catch (e: any) {
      console.warn("restaurant detail", e?.message);
    } finally {
      setLoading(false);
    }
  }, [place_id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleSave() {
    if (!restaurant || alreadySaved || saved || saving) return;
    setSaving(true);
    try {
      await addToWishlist(restaurant.google_place_id, { source: "manual" });
      void triggerHapticSuccess();
      setSaved(true);
      const c = pickSaveCopy();
      setTimeout(() => Alert.alert(c.title, c.body), 200);
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "Try again");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
      </SafeAreaView>
    );
  }

  if (!restaurant) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={type.subtitle}>Couldn't load this place.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const r = restaurant;
  const showSaved = saved || alreadySaved;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Place</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <Text style={styles.heroName}>{r.name}</Text>
            {matchScore != null && (
              <View style={styles.matchBadge}>
                <Text style={styles.matchBadgeText}>{matchScore}% match</Text>
              </View>
            )}
          </View>
          <Text style={styles.heroSub}>
            {[r.cuisine_type ? cap(r.cuisine_type) : null, r.neighborhood, r.address].filter(Boolean).join(" · ")}
          </Text>
          {r.rating != null && (
            <Text style={styles.heroRating}>
              ★ {r.rating.toFixed(1)}{r.user_rating_count ? ` · ${r.user_rating_count.toLocaleString()} reviews on Google` : ""}
            </Text>
          )}
          {matchReasons.length > 0 && (
            <View style={styles.reasonRow}>
              {matchReasons.map((rr, i) => (
                <Text key={i} style={styles.reasonText}>· {rr}</Text>
              ))}
            </View>
          )}
        </View>

        {/* Action row */}
        <View style={styles.actions}>
          <Pressable onPress={handleSave} disabled={showSaved} style={[styles.actionBtn, showSaved && styles.actionBtnDone]}>
            <Text style={[styles.actionBtnText, showSaved && styles.actionBtnTextDone]}>
              {saving ? "…" : showSaved ? "Saved" : "Save"}
            </Text>
          </Pressable>
          <Pressable onPress={() => openInAppleMaps(r.name, r.neighborhood)} style={styles.actionGhost}>
            <Text style={styles.actionGhostText}>Apple Maps</Text>
          </Pressable>
          <Pressable onPress={() => openInGoogleMaps(r.name, r.neighborhood)} style={styles.actionGhost}>
            <Text style={styles.actionGhostText}>Google Maps</Text>
          </Pressable>
        </View>

        <Spacer size={24} />

        {/* Your visits */}
        <Text style={type.micro}>YOUR HISTORY HERE</Text>
        <Spacer size={8} />
        {visits.length === 0 ? (
          <Text style={[type.body, { color: colors.mute, lineHeight: 22 }]}>
            You haven't been here yet. {showSaved ? "We'll surface it when you're nearby." : "Save it and we'll resurface."}
          </Text>
        ) : (
          <>
            <Text style={styles.visitCount}>
              {visits.length} visit{visits.length === 1 ? "" : "s"}
            </Text>
            {visits.map((v) => (
              <Pressable
                key={v.id}
                onPress={() => router.push(`/visit/${v.id}`)}
                style={styles.visitRow}
              >
                {v.photo_url ? (
                  <Image source={{ uri: v.photo_url }} style={styles.visitThumb} />
                ) : (
                  <View style={styles.visitDot} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.visitDate}>
                    {new Date(v.visited_at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                  </Text>
                  <Text style={[type.small, { marginTop: 2 }]}>
                    {new Date(v.visited_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    {" · "}{cap(v.meal_type)}
                  </Text>
                  {v.notes && <Text style={styles.visitNote} numberOfLines={2}>"{v.notes}"</Text>}
                </View>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.line, borderBottomWidth: 1,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.faint,
  },
  closeText: { fontSize: 18, fontWeight: "700", color: colors.ink },
  body: { padding: spacing.lg, paddingBottom: 80 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },

  heroCard: {
    padding: spacing.lg,
    borderRadius: 22,
    backgroundColor: colors.ink,
  },
  heroTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  heroName: {
    flex: 1, color: "#fff", fontSize: 28, fontWeight: "800", letterSpacing: -0.6, lineHeight: 32,
  },
  heroSub: { color: "rgba(255,255,255,0.78)", fontSize: 14, marginTop: 8, lineHeight: 20 },
  heroRating: { color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: 6, fontWeight: "600" },
  matchBadge: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: colors.red,
  },
  matchBadgeText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  reasonRow: { marginTop: 12, gap: 4 },
  reasonText: { color: "rgba(255,255,255,0.85)", fontSize: 13 },

  actions: { flexDirection: "row", gap: 8, marginTop: 14 },
  actionBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 14,
    backgroundColor: colors.red,
    alignItems: "center",
  },
  actionBtnDone: { backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line },
  actionBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  actionBtnTextDone: { color: colors.mute },
  actionGhost: {
    paddingHorizontal: 12, paddingVertical: 12, borderRadius: 14,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  actionGhostText: { fontSize: 13, fontWeight: "700", color: colors.ink },

  visitCount: { ...type.subtitle, marginBottom: 10 },
  visitRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12,
    borderBottomColor: colors.line, borderBottomWidth: 1,
  },
  visitThumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.faint },
  visitDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.red },
  visitDate: { fontSize: 15, fontWeight: "700", color: colors.ink },
  visitNote: { fontSize: 13, color: colors.mute, marginTop: 4, fontStyle: "italic", lineHeight: 18 },
});
