import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, spacing, type, radius } from "../../theme";
import { supabase } from "../../lib/supabase";
import { loadSimilarRestaurants, type SimilarRestaurant } from "../../lib/similar-restaurants";
import { distanceKm } from "../../lib/match-score";

// ============================================================================
// /similar/[place_id] — "More like Almyra" results.
// Anchors on a source restaurant; ranks others by cuisine/region/price/format/
// neighborhood/tag overlap via the `similar_restaurants` RPC.
// ============================================================================

type SourceRestaurant = {
  id: string;
  name: string;
  cuisine_type: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
};

export default function SimilarScreen() {
  const router = useRouter();
  const { place_id } = useLocalSearchParams<{ place_id: string }>();
  const [source, setSource] = useState<SourceRestaurant | null>(null);
  const [matches, setMatches] = useState<SimilarRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [excludeVisited, setExcludeVisited] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: rest } = await supabase
        .from("restaurants_resolved")
        .select("id, name, cuisine_type:resolved_cuisine_type, neighborhood, latitude, longitude")
        .eq("google_place_id", place_id)
        .maybeSingle();
      if (!rest) {
        setSource(null);
        setMatches([]);
        return;
      }
      setSource(rest as SourceRestaurant);
      const sim = await loadSimilarRestaurants(rest.id, { includeVisited: !excludeVisited });
      setMatches(sim);
    } catch (e: any) {
      console.warn("similar restaurants", e?.message);
    } finally {
      setLoading(false);
    }
  }, [place_id, excludeVisited]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn} hitSlop={8}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.subtitle} numberOfLines={1}>
          {source ? `More like ${source.name}` : "Similar"}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.toggleRow}>
        <Text style={type.small}>Include places I've visited</Text>
        <Switch
          value={!excludeVisited}
          onValueChange={(v) => setExcludeVisited(!v)}
          trackColor={{ false: colors.line, true: colors.red }}
        />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
      ) : matches.length === 0 ? (
        <View style={styles.center}>
          <Text style={type.body}>No similar places nearby yet.</Text>
          <Text style={[type.small, { marginTop: 6, textAlign: "center" }]}>
            As more restaurants get classified in your area, this will fill in.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {matches.map((m) => (
            <SimilarCard
              key={m.id}
              match={m}
              source={source}
              onPress={() => router.push(`/restaurant/${m.google_place_id}` as any)}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SimilarCard({
  match, source, onPress,
}: {
  match: SimilarRestaurant;
  source: SourceRestaurant | null;
  onPress: () => void;
}) {
  const priceMarker = match.price_level != null && match.price_level > 0
    ? "$".repeat(match.price_level)
    : null;
  const km =
    source && source.latitude != null && source.longitude != null
      && match.latitude != null && match.longitude != null
      ? distanceKm(
          { lat: source.latitude, lng: source.longitude },
          { lat: match.latitude, lng: match.longitude },
        )
      : null;
  const distLabel = km != null
    ? (km < 1 ? `${Math.round(km * 1000)} m away` : `${km.toFixed(1)} km away`)
    : null;
  const subline = [
    match.cuisine_type ? cap(match.cuisine_type) : null,
    match.neighborhood,
    priceMarker,
    distLabel,
  ].filter(Boolean).join(" · ");

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <View style={styles.cardTopRow}>
        <Text style={styles.cardName} numberOfLines={1}>{match.name}</Text>
        <View style={styles.scorePill}>
          <Text style={styles.scorePillText}>{Math.round(match.similarity_score)}</Text>
        </View>
      </View>
      {subline.length > 0 && <Text style={styles.cardSub}>{subline}</Text>}
      {match.why && <Text style={styles.cardWhy}>{match.why}</Text>}
      {match.rating != null && (
        <Text style={styles.cardRating}>
          ★ {match.rating.toFixed(1)}
          {match.user_rating_count ? ` · ${match.user_rating_count.toLocaleString()} reviews` : ""}
        </Text>
      )}
    </Pressable>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line,
  },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  closeText: { fontSize: 22, color: colors.ink },
  toggleRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  body: { padding: spacing.md, gap: spacing.sm },
  card: {
    backgroundColor: colors.faint,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardName: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.ink, letterSpacing: -0.3 },
  cardSub: { fontSize: 13, color: colors.mute },
  cardWhy: { fontSize: 12, color: colors.red, marginTop: 2, fontWeight: "600" },
  cardRating: { fontSize: 12, color: colors.mute, marginTop: 4 },
  scorePill: {
    backgroundColor: colors.ink,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full,
    marginLeft: spacing.sm,
  },
  scorePillText: { color: "#fff", fontSize: 12, fontWeight: "800" },
});
