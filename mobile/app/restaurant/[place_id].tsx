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
import { Confetti } from "../../components/Confetti";
import {
  myRatingsForRestaurant, topItemsForRestaurant,
  type MyItemRating, type MenuItemSummary,
} from "../../lib/menu-items";
import { loadEditorialBlurb } from "../../lib/restaurant-blurb";

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
  recommendation_eligibility: number | null;
  ineligibility_reason: string | null;
  // Per-field 0..1 confidence from the rule engine. JSONB on the DB side.
  classification_confidence?: {
    cuisine_type?: number;
    cuisine_subregion?: number;
    cuisine_region?: number;
    format_class?: number;
    chain_type?: number;
    cultural_context?: number;
  } | null;
  // Raw algorithmic values — present when reading the `restaurants_resolved`
  // view. We overlay them with resolved_* below so `cuisine_type` reflects
  // any user override; the `_raw` versions stay so we can show a "user-
  // corrected" badge by comparing.
  resolved_cuisine_type?: string | null;
  resolved_cuisine_subregion?: string | null;
  resolved_cuisine_region?: string | null;
  resolved_format_class?: string | null;
  resolved_chain_type?: string | null;
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
  const [myItems, setMyItems] = useState<MyItemRating[]>([]);
  const [topItems, setTopItems] = useState<MenuItemSummary[]>([]);
  const [confettiKey, setConfettiKey] = useState(0);
  const [cuisineOverridden, setCuisineOverridden] = useState(false);
  const [blurb, setBlurb] = useState<string | null>(null);
  const [blurbLoading, setBlurbLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      const { data: rest, error: rErr } = await supabase
        .from("restaurants_resolved")
        .select("*")
        .eq("google_place_id", place_id)
        .maybeSingle();
      if (rErr || !rest) {
        setLoading(false);
        return;
      }
      // Overlay so consumers reading `.cuisine_type` etc. see the resolved
      // (override-applied) value. The raw `resolved_*` keys stay on the row
      // so the badge logic can detect "this was user-corrected" by diff.
      const raw = rest as RestaurantRow;
      const r: RestaurantRow = {
        ...raw,
        cuisine_type:      raw.resolved_cuisine_type      ?? raw.cuisine_type,
        cuisine_subregion: raw.resolved_cuisine_subregion ?? raw.cuisine_subregion,
        cuisine_region:    raw.resolved_cuisine_region    ?? raw.cuisine_region,
        format_class:      raw.resolved_format_class      ?? raw.format_class,
      };
      setRestaurant(r);
      // Override exists when the resolved value diverges from the raw
      // algorithmic value. Drives the "✓ Corrected" badge + revert action.
      setCuisineOverridden(
        raw.resolved_cuisine_type != null
        && raw.resolved_cuisine_type !== raw.cuisine_type,
      );
      // Editorial blurb fires in the background — null is fine, the slot
      // hides itself when there's no LLM key or no review snippets yet. The
      // loading flag drives a skeleton so cold-cache fetches don't look broken.
      setBlurbLoading(true);
      void loadEditorialBlurb(place_id)
        .then((b) => { setBlurb(b); })
        .catch(() => setBlurb(null))
        .finally(() => setBlurbLoading(false));

      const [visitsRes, vector, wishRes, mine, top] = await Promise.all([
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
        myRatingsForRestaurant(r.id).catch(() => []),
        topItemsForRestaurant(r.id, 5).catch(() => []),
      ]);

      setVisits((visitsRes as any).data ?? []);
      setAlreadySaved(!!(wishRes as any).data);
      setMyItems(mine);
      setTopItems(top);
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

  // Common cuisines for the override picker. Intentionally short — covers
  // ~80% of corrections; users with a less-common cuisine can submit again
  // later once we add a free-text picker.
  const CUISINE_CHOICES = [
    "italian", "chinese", "japanese", "korean",
    "thai", "mexican", "indian", "mediterranean",
  ];

  function reportWrongCuisine() {
    if (!restaurant) return;
    Alert.alert(
      "What cuisine is it?",
      "We'll update this place for everyone.",
      [
        ...CUISINE_CHOICES.map((c) => ({
          text: cap(c),
          onPress: () => submitCuisineOverride(c),
        })),
        { text: "Cancel", style: "cancel" as const },
      ],
    );
  }

  async function submitCuisineOverride(cuisine: string) {
    if (!restaurant) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert("Sign in required", "Log in to submit a correction.");
      return;
    }
    const { error } = await supabase
      .from("restaurant_overrides")
      .upsert(
        {
          restaurant_id: restaurant.id,
          user_id: user.id,
          field: "cuisine_type",
          value: cuisine,
        },
        { onConflict: "restaurant_id,field" },
      );
    if (error) {
      Alert.alert("Couldn't update cuisine", humanizeSupabaseError(error));
      return;
    }
    // Optimistic local update so the screen reflects the change immediately.
    setRestaurant({ ...restaurant, cuisine_type: cuisine });
    setCuisineOverridden(true);
    void triggerHapticSuccess();
  }

  function revertCuisineOverride() {
    if (!restaurant) return;
    Alert.alert(
      "Revert cuisine?",
      "This will restore the original algorithmic guess for this place.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revert",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase
              .from("restaurant_overrides")
              .delete()
              .eq("restaurant_id", restaurant.id)
              .eq("field", "cuisine_type");
            if (error) {
              Alert.alert("Couldn't revert", humanizeSupabaseError(error));
              return;
            }
            await load();
          },
        },
      ],
    );
  }

  async function handleSave() {
    if (!restaurant || alreadySaved || saved || saving) return;
    setSaving(true);
    try {
      await addToWishlist(restaurant.google_place_id, { source: "manual" });
      void triggerHapticSuccess();
      setSaved(true);
      setConfettiKey((k) => k + 1);
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
  // Mute the cuisine label when the classifier was uncertain AND no user
  // override has confirmed it. Threshold chosen empirically: the eval shows
  // values above 0.5 are usually right, below 0.5 are coin-flips.
  const cuisineConf = r.classification_confidence?.cuisine_type;
  const lowConfCuisine =
    r.cuisine_type != null
    && !cuisineOverridden
    && cuisineConf != null
    && cuisineConf < 0.5;

  return (
    <SafeAreaView style={styles.safe}>
      <Confetti fire={confettiKey > 0} count={90} />
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
            {r.cuisine_type ? (
              <Text style={lowConfCuisine ? styles.heroCuisineMuted : undefined}>
                {cap(r.cuisine_type)}{lowConfCuisine ? " (best guess)" : ""}
              </Text>
            ) : null}
            {r.cuisine_type && (r.neighborhood || r.address) ? " · " : ""}
            {[r.neighborhood, r.address].filter(Boolean).join(" · ")}
          </Text>
          {cuisineOverridden ? (
            <View style={styles.correctedRow}>
              <View style={styles.correctedBadge}>
                <Text style={styles.correctedBadgeText}>✓ Corrected by users</Text>
              </View>
              <Pressable onPress={revertCuisineOverride} hitSlop={6}>
                <Text style={styles.cuisineCorrect}>Revert</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={reportWrongCuisine} hitSlop={6}>
              <Text style={styles.cuisineCorrect}>
                {r.cuisine_type ? "Wrong cuisine? Tap to fix" : "Add cuisine"}
              </Text>
            </Pressable>
          )}
          {r.rating != null && (
            <Text style={styles.heroRating}>
              ★ {r.rating.toFixed(1)}{r.user_rating_count ? ` · ${r.user_rating_count.toLocaleString()} reviews on Google` : ""}
            </Text>
          )}
          {blurb ? (
            <Text style={styles.heroBlurb}>{blurb}</Text>
          ) : blurbLoading ? (
            <Text style={styles.heroBlurbLoading}>Reading reviews…</Text>
          ) : null}
          {ineligibilityHint(r) && (
            <Text style={styles.ineligibleHint}>{ineligibilityHint(r)}</Text>
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

        <Pressable
          onPress={() => router.push(`/similar/${r.google_place_id}` as any)}
          style={({ pressed }) => [styles.similarBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.similarBtnText}>Find more like {r.name}</Text>
        </Pressable>

        <Spacer size={24} />

        {/* Your items here — surfaces the post-visit ratings the user gave. */}
        {myItems.length > 0 && (
          <>
            <Text style={type.micro}>YOUR ITEMS HERE</Text>
            <Spacer size={8} />
            {myItems.slice(0, 6).map((m) => (
              <View key={m.item.id} style={styles.itemRow}>
                <Text style={styles.itemName} numberOfLines={1}>{m.item.name}</Text>
                <View style={[styles.ratingPill, ratingPillStyle(m.rating)]}>
                  <Text style={[styles.ratingPillText, ratingPillTextStyle(m.rating)]}>
                    {ratingLabel(m.rating)}
                  </Text>
                </View>
              </View>
            ))}
            <Spacer size={20} />
          </>
        )}

        {/* What people loved here — aggregate signal across all users. */}
        {topItems.length > 0 && (
          <>
            <Text style={type.micro}>WHAT PEOPLE LOVED</Text>
            <Spacer size={8} />
            {topItems.slice(0, 5).map((it) => (
              <View key={it.id} style={styles.itemRow}>
                <Text style={styles.itemName} numberOfLines={1}>{it.name}</Text>
                <Text style={styles.lovedCount}>
                  ♥ {it.loved_count}
                </Text>
              </View>
            ))}
            <Spacer size={20} />
          </>
        )}

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

// Translate raw Supabase/PostgREST errors into something a non-technical
// user can act on. The default just returns the error message — we
// override only for codes/messages we've actually seen surface in the app.
function humanizeSupabaseError(err: { message?: string; code?: string } | null | undefined): string {
  if (!err) return "Something went wrong. Try again.";
  const msg = (err.message ?? "").toLowerCase();
  if (err.code === "42501" || msg.includes("permission") || msg.includes("rls")) {
    return "You don't have permission to do that.";
  }
  if (msg.includes("network") || msg.includes("failed to fetch") || msg.includes("timeout")) {
    return "Couldn't reach Palate. Check your connection and try again.";
  }
  if (msg.includes("duplicate") || msg.includes("conflict")) {
    return "This correction already exists. Refresh and try again.";
  }
  return err.message ?? "Something went wrong. Try again.";
}

// Maps the classifier's machine reason codes to a single-line user-facing
// note. Returns null when the place IS eligible for discovery — caller
// hides the slot in that case.
function ineligibilityHint(r: { recommendation_eligibility?: number | null; ineligibility_reason?: string | null }): string | null {
  if (r.recommendation_eligibility == null || r.recommendation_eligibility > 0) return null;
  switch (r.ineligibility_reason) {
    case "airport":         return "Inside an airport — not surfaced in discovery.";
    case "lounge_gated":    return "Members-only / airport lounge — not surfaced in discovery.";
    case "lounge":          return "Lounge — not surfaced in discovery.";
    case "fast_food":       return "Fast food — not surfaced in discovery.";
    case "hotel":
    case "hotel_generic":   return "Hotel restaurant — not surfaced in discovery.";
    case "national_chain":  return "National chain — not surfaced in discovery.";
    default:                return "Not surfaced in discovery.";
  }
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
}

function ratingLabel(r: "loved" | "ok" | "not_for_me"): string {
  if (r === "loved") return "Loved";
  if (r === "ok") return "OK";
  return "Not for me";
}

function ratingPillStyle(r: "loved" | "ok" | "not_for_me") {
  if (r === "loved") return { backgroundColor: colors.redTint, borderColor: colors.redTintBorder };
  if (r === "ok") return { backgroundColor: colors.faint, borderColor: colors.line };
  return { backgroundColor: colors.paper, borderColor: colors.line };
}

function ratingPillTextStyle(r: "loved" | "ok" | "not_for_me") {
  if (r === "loved") return { color: colors.red };
  if (r === "ok") return { color: colors.mute };
  return { color: colors.mute };
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
  heroCuisineMuted: {
    color: "rgba(255,255,255,0.5)", fontStyle: "italic",
  },
  cuisineCorrect: {
    color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 6,
    textDecorationLine: "underline",
  },
  correctedRow: {
    flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8,
  },
  correctedBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  correctedBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  heroRating: { color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: 6, fontWeight: "600" },
  heroBlurb: {
    color: "rgba(255,255,255,0.92)", fontSize: 14, marginTop: 12,
    lineHeight: 20, fontStyle: "italic",
  },
  heroBlurbLoading: {
    color: "rgba(255,255,255,0.4)", fontSize: 13, marginTop: 12,
    fontStyle: "italic",
  },
  ineligibleHint: {
    color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 10,
    fontWeight: "500",
  },
  matchBadge: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: colors.primary,
  },
  matchBadgeText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  reasonRow: { marginTop: 12, gap: 4 },
  reasonText: { color: "rgba(255,255,255,0.85)", fontSize: 13 },

  actions: { flexDirection: "row", gap: 8, marginTop: 14 },
  actionBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 14,
    backgroundColor: colors.primary,
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
  similarBtn: {
    marginTop: 12,
    backgroundColor: colors.ink,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },
  similarBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  visitCount: { ...type.subtitle, marginBottom: 10 },
  visitRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12,
    borderBottomColor: colors.line, borderBottomWidth: 1,
  },
  visitThumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.faint },
  visitDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.mute },
  visitDate: { fontSize: 15, fontWeight: "700", color: colors.ink },
  visitNote: { fontSize: 13, color: colors.mute, marginTop: 4, fontStyle: "italic", lineHeight: 18 },

  itemRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomColor: colors.line, borderBottomWidth: 1,
    gap: 12,
  },
  itemName: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.ink },
  ratingPill: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  ratingPillText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  lovedCount: { fontSize: 12, fontWeight: "700", color: colors.red },
});
