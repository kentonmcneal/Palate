import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Alert, Linking, Platform, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
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
import { rankRestaurantsForDiscovery, type DiscoveryBuckets, type RankedRestaurant } from "../../lib/restaurant-ranking";
import { trackImpressions } from "../../lib/recommendation-events";
import { RestaurantCompatibilityCard } from "../../components/RestaurantCompatibilityCard";
import { Shimmer, CardSkeleton, ListSkeleton } from "../../components/Shimmer";
import { getCachedNearby, setCachedNearby } from "../../lib/nearby-cache";

// ============================================================================
// Discover tab — three sections:
//   1. Map view — nearby restaurants, accent the high-match ones
//   2. For You — top 10 ranked recommendations (persona + match score)
//   3. Lists — 4 curated "shelves" filtered from nearby spots
//      (Late-night near you, Brunch picks, Date-night, Healthy-lunch)
// ============================================================================

const MAP_RADIUS_M = 2500; // ~1.5mi — wide enough to fill shelves, tight enough to feel local
const HIGH_MATCH_THRESHOLD = 75;
const SHELF_TARGET = 7;

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
  const router = useRouter();
  // Progressive loading: each section has its own state so we don't block
  // the whole tab while one piece loads.
  const [hereLoading, setHereLoading] = useState(true);
  const [placesLoading, setPlacesLoading] = useState(true);
  const [bucketsLoading, setBucketsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [places, setPlaces] = useState<EnrichedPlace[]>([]);
  const [buckets, setBuckets] = useState<DiscoveryBuckets | null>(null);

  const load = useCallback(async (forceRefresh = false) => {
    try {
      setError(null);
      setHereLoading(true);

      // Step 1 — get location (fast, ~50-300ms)
      const loc = await getCurrentLocation().catch(() => null);
      if (!loc) {
        setError("Turn on location in Settings → Palate to see what's nearby.");
        setHereLoading(false); setPlacesLoading(false); setBucketsLoading(false);
        return;
      }
      const conf = classifyAccuracy(loc.accuracy);
      if (conf === "low") {
        setError("Your location signal is fuzzy. Step outside and pull to refresh.");
        setHereLoading(false); setPlacesLoading(false); setBucketsLoading(false);
        return;
      }
      setHere({ lat: loc.lat, lng: loc.lng });
      setHereLoading(false);

      // Step 2 — nearby restaurants (cached up to 5 min). Render the map +
      // shelves as soon as this lands; ranker can finish async after.
      setPlacesLoading(true);
      let nearby = forceRefresh ? null : await getCachedNearby(loc.lat, loc.lng, MAP_RADIUS_M);
      if (!nearby) {
        nearby = await nearbyRestaurants(loc.lat, loc.lng, MAP_RADIUS_M);
        void setCachedNearby(loc.lat, loc.lng, MAP_RADIUS_M, nearby);
      }

      const enriched: EnrichedPlace[] = nearby.map((p) => {
        const ctx = {
          cuisineRegion: (p as any).cuisine_region ?? null,
          cuisineSubregion: (p as any).cuisine_subregion ?? null,
          formatClass: (p as any).format_class ?? null,
          occasionTags: (p as any).occasion_tags ?? null,
          flavorTags: (p as any).flavor_tags ?? null,
        };
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
          matchScore: null, // filled in below once we have the vector
          distanceKm: km,
          ...ctx,
        };
      });
      setPlaces(enriched);
      setPlacesLoading(false);

      // Step 3 — vector + ranker (heavier). Don't block earlier sections.
      setBucketsLoading(true);
      const vector = await computeTasteVector().catch(() => null);

      // Score matches lazily for the map overlay — only top 30 by distance
      const visibleForMap = enriched.slice(0, 30).map((p) => {
        const recShape = { cuisine: p.cuisine, price_level: p.price_level, neighborhood: p.neighborhood };
        const m = vector ? scoreMatch(vector, recShape, {
          cuisineRegion: (p as any).cuisineRegion,
          cuisineSubregion: (p as any).cuisineSubregion,
          formatClass: (p as any).formatClass,
          occasionTags: (p as any).occasionTags,
          flavorTags: (p as any).flavorTags,
        }) : null;
        return { ...p, matchScore: m?.score ?? null };
      });
      setPlaces((prev) => prev.map((p) => visibleForMap.find((v) => v.google_place_id === p.google_place_id) ?? p));

      const bucketed = await rankRestaurantsForDiscovery({
        vector,
        candidates: nearby.map((p) => ({
          google_place_id: p.google_place_id,
          name: p.name,
          cuisine_type: p.cuisine_type ?? null,
          cuisine_region: (p as any).cuisine_region ?? null,
          cuisine_subregion: (p as any).cuisine_subregion ?? null,
          format_class: (p as any).format_class ?? null,
          occasion_tags: (p as any).occasion_tags ?? null,
          flavor_tags: (p as any).flavor_tags ?? null,
          cultural_context: (p as any).cultural_context ?? null,
          neighborhood: p.neighborhood ?? null,
          price_level: p.price_level ?? null,
          rating: p.rating ?? null,
          user_rating_count: (p as any).user_rating_count ?? null,
          latitude: p.latitude ?? null,
          longitude: p.longitude ?? null,
        })),
        here: { lat: loc.lat, lng: loc.lng },
        now: new Date(),
        perBucket: 6,
      });
      setBuckets(bucketed);
      setBucketsLoading(false);

      // Fire impressions for whatever we ended up surfacing
      const visiblePlaceIds = [
        ...bucketed.safe.map((r) => r.google_place_id),
        ...bucketed.stretch.map((r) => r.google_place_id),
        ...bucketed.aspirational.map((r) => r.google_place_id),
      ];
      void trackImpressions(visiblePlaceIds, { surface: "discover_for_you" });
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load Discover");
      setHereLoading(false); setPlacesLoading(false); setBucketsLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (error) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={[type.body, { color: colors.mute, textAlign: "center", paddingHorizontal: 32 }]}>
            {error}
          </Text>
          <Spacer />
          <Pressable onPress={() => load(true)} style={styles.retry}>
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
            onRefresh={async () => { setRefreshing(true); await load(true); setRefreshing(false); }}
          />
        }
      >
        <Text style={type.title}>Discover</Text>
        <Text style={[type.body, { color: colors.mute, marginTop: 4 }]}>
          What's around you, ranked for your Palate.
        </Text>

        <Spacer size={20} />

        {/* Map — show skeleton until location resolves */}
        {hereLoading && !here && (
          <Shimmer height={240} borderRadius={18} />
        )}
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
            <Pressable onPress={() => router.push("/map")} style={styles.mapExpand}>
              <Text style={styles.mapExpandText}>Expand ⤢</Text>
            </Pressable>
          </View>
        )}

        {/* Bucketed Discovery — show skeleton cards while ranker runs */}
        {bucketsLoading && !buckets && (
          <View style={{ marginTop: spacing.xl }}>
            <Text style={type.subtitle}>Safe Matches</Text>
            <View style={{ height: 12 }} />
            <CardSkeleton />
            <CardSkeleton />
          </View>
        )}
        {buckets && (
          <>
            <BucketSection
              title="Safe Matches"
              subtitle="Highly aligned with your current Palate."
              items={buckets.safe}
              bucket="safe"
            />
            <BucketSection
              title="Stretch Picks"
              subtitle="Slightly outside your pattern — but plausible."
              items={buckets.stretch}
              bucket="stretch"
            />
            <BucketSection
              title="Your Next Era"
              subtitle="Aligned with what you've been saving."
              items={buckets.aspirational}
              bucket="aspirational"
            />
            <BucketSection
              title="Trending Around You"
              subtitle="Popular nearby — fit-adjusted for you."
              items={buckets.trending}
              bucket="trending"
            />
            <BucketSection
              title="Friends Like This"
              subtitle="Where your friends have been."
              items={buckets.friends}
              bucket="friends"
            />
          </>
        )}

        {/* Lists */}
        <Section title="Lists">
          <Shelf
            title="Late-night near you"
            blurb="Open after 9pm, walking distance."
            items={broadShelf(places, {
              occasions: ["late_night"],
              formats: ["bar", "wine_bar"],
            })}
          />
          <Shelf
            title="Brunch picks"
            blurb="For a slow Saturday."
            items={broadShelf(places, {
              occasions: ["brunch", "breakfast", "weekend_anchor"],
              formats: ["café"],
            })}
          />
          <Shelf
            title="Date-night nearby"
            blurb="Slightly more deliberate."
            items={broadShelf(places, {
              occasions: ["date_night", "group_dinner"],
              minPrice: 3,
            })}
          />
          <Shelf
            title="Healthy-lunch picks"
            blurb="Fresh, fast, on the way."
            items={broadShelf(places, {
              cuisines: ["healthy", "mediterranean"],
              flavors: ["fresh", "light"],
            })}
          />
          <Shelf
            title="Quick & on the way"
            blurb="Counter-service, in and out."
            items={broadShelf(places, {
              formats: ["quick_service", "fast_casual"],
            })}
          />
          <Shelf
            title="Hidden gems near you"
            blurb="Off the radar, low review count."
            items={broadShelf(places, {
              cultural: ["hidden"],
            })}
          />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function BucketSection({
  title, subtitle, items, bucket,
}: {
  title: string;
  subtitle: string;
  items: RankedRestaurant[];
  bucket: "safe" | "stretch" | "aspirational" | "trending" | "friends";
}) {
  if (items.length === 0) return null;
  return (
    <Section title={title} subtitle={subtitle}>
      {items.map((r) => (
        <RestaurantCompatibilityCard
          key={r.google_place_id}
          restaurant={r}
          surface="discover_for_you"
          bucket={bucket}
        />
      ))}
    </Section>
  );
}

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
// Filters for the Lists shelves — broad multi-criteria, always tries to hit
// SHELF_TARGET items by widening when the strict filter comes up short.
// ----------------------------------------------------------------------------

type ShelfCriteria = {
  occasions?: string[];
  formats?: string[];
  cuisines?: string[];
  flavors?: string[];
  cultural?: string[];
  minPrice?: number;
};

function broadShelf(places: EnrichedPlace[], c: ShelfCriteria): EnrichedPlace[] {
  // Pass 1: strict — match ANY criterion in EACH provided category.
  const strict = places.filter((p) => {
    if (c.occasions?.length && !p.occasionTags?.some((t) => c.occasions!.includes(t))) return false;
    if (c.formats?.length && !c.formats.includes(p.formatClass ?? "")) return false;
    if (c.cuisines?.length && !c.cuisines.includes(p.cuisine ?? "")) return false;
    if (c.flavors?.length && !p.flavorTags?.some((f) => c.flavors!.includes(f))) return false;
    if (c.cultural?.length) {
      // cultural lives at the restaurant level — read via any-cast since not strongly typed here
      const ctx = (p as any).culturalContext ?? null;
      if (!c.cultural.includes(ctx)) return false;
    }
    if (c.minPrice != null && (p.price_level ?? 0) < c.minPrice) return false;
    return true;
  });

  if (strict.length >= SHELF_TARGET) {
    return sortByMatch(strict).slice(0, SHELF_TARGET + 3);
  }

  // Pass 2: loose — OR across all criteria so we fill the shelf with
  // anything plausibly related rather than showing 2 items.
  const loose = places.filter((p) => {
    if (c.occasions?.some((o) => p.occasionTags?.includes(o))) return true;
    if (c.formats?.includes(p.formatClass ?? "")) return true;
    if (c.cuisines?.includes(p.cuisine ?? "")) return true;
    if (c.flavors?.some((f) => p.flavorTags?.includes(f))) return true;
    if (c.cultural?.includes((p as any).culturalContext ?? "")) return true;
    if (c.minPrice != null && (p.price_level ?? 0) >= c.minPrice) return true;
    return false;
  });

  // Combine, dedupe by id, prefer strict-matchers first
  const seen = new Set<string>();
  const out: EnrichedPlace[] = [];
  for (const p of [...strict, ...sortByMatch(loose)]) {
    if (seen.has(p.google_place_id)) continue;
    seen.add(p.google_place_id);
    out.push(p);
    if (out.length >= SHELF_TARGET + 3) break;
  }
  return out;
}

function sortByMatch(places: EnrichedPlace[]): EnrichedPlace[] {
  return [...places].sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
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
  mapExpand: {
    position: "absolute", top: 10, right: 10,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.ink,
  },
  mapExpandText: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },

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
