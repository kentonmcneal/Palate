import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Alert, Linking, Platform, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { MatchMarker, TopMatchMarker } from "../../components/MatchMarker";
import { Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { nearbyRestaurants } from "../../lib/places";
import { getCurrentLocation, classifyAccuracy } from "../../lib/location";
import { computeTasteVector, type TasteVector } from "../../lib/taste-vector";
import { scoreMatch, formatDistance, distanceKm } from "../../lib/match-score";
import {
  generateWeeklyPalatePersona,
  getPersonaRecommendations,
} from "../../lib/palate-persona";
import { isoWeekStart } from "../../lib/wrapped";
import { addToWishlist, type RestaurantRecommendation } from "../../lib/palate-insights";
import { triggerHapticSuccess } from "../../lib/haptics";
import { pickSaveCopy } from "../../lib/save-copy";

// ============================================================================
// Discover tab — three sections:
//   1. Map view — nearby restaurants, accent the high-match ones
//   2. For You — top 10 ranked recommendations (persona + match score)
//   3. Lists — 4 curated "shelves" filtered from nearby spots
//      (Late-night near you, Brunch picks, Date-night, Healthy-lunch)
// ============================================================================

const MAP_RADIUS_M = 1000;
const HIGH_MATCH_THRESHOLD = 75;

type EnrichedPlace = {
  google_place_id: string;
  name: string;
  cuisine: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  price_level: number | null;
  matchScore: number | null;
  distanceKm: number | null;
  cuisineRegion?: string | null;
  cuisineSubregion?: string | null;
  formatClass?: string | null;
  occasionTags?: string[] | null;
  flavorTags?: string[] | null;
};

export default function DiscoverTab() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [places, setPlaces] = useState<EnrichedPlace[]>([]);
  const [forYou, setForYou] = useState<RestaurantRecommendation[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const loc = await getCurrentLocation().catch(() => null);
      if (!loc) {
        setError("Turn on location in Settings → Palate to see what's nearby.");
        setLoading(false);
        return;
      }
      const conf = classifyAccuracy(loc.accuracy);
      if (conf === "low") {
        setError("Your location signal is fuzzy. Step outside and pull to refresh.");
        setLoading(false);
        return;
      }
      setHere({ lat: loc.lat, lng: loc.lng });

      const [nearby, vector] = await Promise.all([
        nearbyRestaurants(loc.lat, loc.lng, MAP_RADIUS_M),
        computeTasteVector().catch(() => null),
      ]);

      const enriched: EnrichedPlace[] = nearby.map((p) => {
        const ctx = {
          cuisineRegion: (p as any).cuisine_region ?? null,
          cuisineSubregion: (p as any).cuisine_subregion ?? null,
          formatClass: (p as any).format_class ?? null,
          occasionTags: (p as any).occasion_tags ?? null,
          flavorTags: (p as any).flavor_tags ?? null,
        };
        // scoreMatch expects RestaurantRecommendation field names; adapt the
        // Restaurant DB row to that shape.
        const recShape = {
          cuisine: p.cuisine_type ?? null,
          price_level: p.price_level ?? null,
          neighborhood: p.neighborhood ?? null,
        };
        const m = vector ? scoreMatch(vector, recShape, ctx) : null;
        const km = p.latitude != null && p.longitude != null
          ? distanceKm({ lat: loc.lat, lng: loc.lng }, { lat: p.latitude, lng: p.longitude })
          : null;
        return {
          google_place_id: p.google_place_id,
          name: p.name,
          cuisine: p.cuisine_type ?? null,
          neighborhood: p.neighborhood ?? null,
          latitude: p.latitude ?? null,
          longitude: p.longitude ?? null,
          rating: p.rating ?? null,
          price_level: p.price_level ?? null,
          matchScore: m?.score ?? null,
          distanceKm: km,
          ...ctx,
        };
      });
      setPlaces(enriched);

      // For You: pull persona-driven recs (already match-scored elsewhere)
      const start = isoWeekStart();
      const end = new Date().toISOString().slice(0, 10);
      const persona = await generateWeeklyPalatePersona(start, end);
      if (persona) {
        const result = await getPersonaRecommendations(persona, start, end, { lat: loc.lat, lng: loc.lng });
        const all: RestaurantRecommendation[] = [...(result.similar ?? [])];
        if (result.stretch) all.push(result.stretch);
        const enrichedForYou = all.slice(0, 10).map((r) => {
          const m = vector ? scoreMatch(vector, r) : null;
          const km = r.latitude != null && r.longitude != null
            ? distanceKm({ lat: loc.lat, lng: loc.lng }, { lat: r.latitude, lng: r.longitude })
            : null;
          return {
            ...r,
            matchScore: m?.score ?? null,
            distanceKm: km,
            reason: m?.reasons[0] ?? r.reason,
          };
        });
        setForYou(enrichedForYou);
      }
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load Discover");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={[type.body, { color: colors.mute, textAlign: "center", paddingHorizontal: 32 }]}>
            {error}
          </Text>
          <Spacer />
          <Pressable onPress={load} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          />
        }
      >
        <Text style={type.title}>Discover</Text>
        <Text style={[type.body, { color: colors.mute, marginTop: 4 }]}>
          What's around you, ranked for your Palate.
        </Text>

        <Spacer size={20} />

        {/* Map */}
        {here && (
          <View style={styles.mapWrap}>
            <MapView
              provider={PROVIDER_DEFAULT}
              style={styles.map}
              initialRegion={{
                latitude: here.lat,
                longitude: here.lng,
                latitudeDelta: 0.012,
                longitudeDelta: 0.012,
              }}
              showsUserLocation
              showsMyLocationButton={false}
            >
              {(() => {
                const visible = places
                  .filter((p) => p.latitude != null && p.longitude != null)
                  .slice(0, 30);
                // Identify the top-match place so we can render it as a flame.
                const topScore = visible.reduce((m, p) => Math.max(m, p.matchScore ?? 0), 0);
                return visible.map((p) => {
                  const isTop = p.matchScore != null && p.matchScore === topScore && topScore >= HIGH_MATCH_THRESHOLD;
                  return (
                    <Marker
                      key={p.google_place_id}
                      coordinate={{ latitude: p.latitude!, longitude: p.longitude! }}
                      title={p.name}
                      description={p.matchScore ? `${p.matchScore}% match` : undefined}
                      anchor={{ x: 0.5, y: 0.5 }}
                    >
                      {isTop
                        ? <TopMatchMarker score={p.matchScore!} />
                        : <MatchMarker score={p.matchScore} />}
                    </Marker>
                  );
                });
              })()}
            </MapView>
            <View style={styles.mapLegend}>
              <View style={styles.mapLegendDot} />
              <Text style={styles.mapLegendText}>High match for you</Text>
            </View>
          </View>
        )}

        {/* For You */}
        <Section title="For You" subtitle="Top picks ranked by your Palate">
          {forYou.length === 0 ? (
            <Text style={[type.small, { lineHeight: 20 }]}>
              Log a few visits and we'll learn what to surface here.
            </Text>
          ) : (
            forYou.slice(0, 6).map((r) => (
              <PlaceRow
                key={r.google_place_id}
                place={{
                  google_place_id: r.google_place_id,
                  name: r.name,
                  cuisine: r.cuisine,
                  neighborhood: r.neighborhood,
                  matchScore: r.matchScore ?? null,
                  distanceKm: r.distanceKm ?? null,
                  reason: r.reason,
                  rating: r.rating ?? null,
                }}
              />
            ))
          )}
        </Section>

        {/* Lists */}
        <Section title="Lists">
          <Shelf
            title="Late-night near you"
            blurb="Open after 9pm, walking distance."
            items={filterShelf(places, "late_night")}
          />
          <Shelf
            title="Brunch picks"
            blurb="For a slow Saturday."
            items={filterShelf(places, "brunch")}
          />
          <Shelf
            title="Date-night nearby"
            blurb="Slightly more deliberate."
            items={filterShelf(places, "date_night")}
          />
          <Shelf
            title="Healthy-lunch picks"
            blurb="Fresh, fast, on the way."
            items={filterShelfByCuisine(places, ["healthy"])}
          />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: spacing.xl }}>
      <Text style={type.subtitle}>{title}</Text>
      {subtitle && (
        <Text style={[type.small, { marginTop: 2, marginBottom: 12 }]}>{subtitle}</Text>
      )}
      {!subtitle && <Spacer size={12} />}
      {children}
    </View>
  );
}

function Shelf({ title, blurb, items }: { title: string; blurb: string; items: EnrichedPlace[] }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.shelf}>
      <Text style={styles.shelfTitle}>{title}</Text>
      <Text style={styles.shelfBlurb}>{blurb}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingTop: 10 }}>
        {items.slice(0, 6).map((p) => (
          <ShelfCard key={p.google_place_id} place={p} />
        ))}
      </ScrollView>
    </View>
  );
}

function ShelfCard({ place }: { place: EnrichedPlace }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (saved || saving) return;
    setSaving(true);
    try {
      await addToWishlist(place.google_place_id, { source: "recommendation" });
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

  return (
    <View style={styles.shelfCard}>
      <View style={{ flex: 1 }}>
        <View style={styles.cardTop}>
          <Text style={styles.cardName} numberOfLines={2}>{place.name}</Text>
          {place.matchScore != null && (
            <View style={styles.matchBadge}>
              <Text style={styles.matchBadgeText}>{place.matchScore}%</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardSub} numberOfLines={1}>
          {[place.cuisine ? capitalize(place.cuisine) : null, place.distanceKm != null ? formatDistance(place.distanceKm) : null]
            .filter(Boolean).join(" · ")}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
        <Pressable
          onPress={save}
          style={[styles.saveBtn, saved && styles.saveBtnDone]}
        >
          <Text style={[styles.saveText, saved && styles.saveTextDone]}>
            {saving ? "…" : saved ? "Saved" : "Save"}
          </Text>
        </Pressable>
        <Pressable onPress={() => openInAppleMaps(place)} style={styles.mapsBtn}>
          <Text style={styles.mapsBtnText}>Maps</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PlaceRow({
  place,
}: {
  place: {
    google_place_id: string; name: string; cuisine: string | null;
    neighborhood: string | null; matchScore: number | null;
    distanceKm: number | null; reason: string; rating: number | null;
  };
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (saved || saving) return;
    setSaving(true);
    try {
      await addToWishlist(place.google_place_id, { source: "recommendation" });
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

  return (
    <View style={styles.placeRow}>
      <View style={{ flex: 1 }}>
        <View style={styles.cardTop}>
          <Text style={styles.placeName} numberOfLines={2}>{place.name}</Text>
          {place.matchScore != null && (
            <View style={styles.matchBadge}>
              <Text style={styles.matchBadgeText}>{place.matchScore}% match</Text>
            </View>
          )}
        </View>
        <Text style={[type.small, { marginTop: 2 }]}>
          {[place.cuisine ? capitalize(place.cuisine) : null, place.neighborhood, place.distanceKm != null ? formatDistance(place.distanceKm) : null]
            .filter(Boolean).join(" · ")}
        </Text>
        <Text style={styles.placeReason}>{place.reason}</Text>
      </View>
      <Pressable onPress={save} style={[styles.saveBtn, saved && styles.saveBtnDone]}>
        <Text style={[styles.saveText, saved && styles.saveTextDone]}>
          {saving ? "…" : saved ? "Saved" : "Save"}
        </Text>
      </Pressable>
    </View>
  );
}

// ----------------------------------------------------------------------------
// Filters for the Lists shelves
// ----------------------------------------------------------------------------
function filterShelf(places: EnrichedPlace[], occasion: string): EnrichedPlace[] {
  return places
    .filter((p) => (p.occasionTags ?? []).includes(occasion))
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
}

function filterShelfByCuisine(places: EnrichedPlace[], cuisines: string[]): EnrichedPlace[] {
  return places
    .filter((p) => cuisines.includes(p.cuisine ?? ""))
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
}

function openInAppleMaps(p: { name: string; neighborhood: string | null }) {
  const query = encodeURIComponent(p.neighborhood ? `${p.name}, ${p.neighborhood}` : p.name);
  const url = Platform.OS === "ios"
    ? `maps://?q=${query}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
  Linking.openURL(url).catch(() => {});
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { padding: spacing.lg, paddingBottom: 100 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },

  retry: {
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999,
    backgroundColor: colors.red,
  },
  retryText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  mapWrap: {
    height: 240,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.faint,
  },
  map: { width: "100%", height: "100%" },
  mapLegend: {
    position: "absolute", top: 10, left: 10,
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderWidth: 1, borderColor: colors.line,
  },
  mapLegendDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red },
  mapLegendText: { fontSize: 11, fontWeight: "700", color: colors.ink },

  shelf: { marginBottom: spacing.md },
  shelfTitle: { fontSize: 17, fontWeight: "800", color: colors.ink, letterSpacing: -0.3 },
  shelfBlurb: { ...type.small, marginTop: 2 },

  shelfCard: {
    width: 220,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.line,
  },

  placeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 14,
    borderBottomColor: colors.line, borderBottomWidth: 1,
    gap: 12,
  },
  placeName: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.ink },
  placeReason: { fontSize: 13, color: colors.mute, marginTop: 6, fontStyle: "italic", lineHeight: 18 },

  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardName: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.ink },
  cardSub: { fontSize: 12, color: colors.mute, marginTop: 4 },

  matchBadge: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#FFF1EE",
    borderWidth: 1, borderColor: "#FFD7CE",
  },
  matchBadgeText: { fontSize: 11, fontWeight: "800", color: colors.red },

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

  mapsBtn: {
    paddingHorizontal: 12, height: 32, borderRadius: 16,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
    alignItems: "center", justifyContent: "center",
  },
  mapsBtnText: { color: colors.mute, fontSize: 13, fontWeight: "700" },
});
