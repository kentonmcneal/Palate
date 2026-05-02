import { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
  TextInput, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { nearbyRestaurants, searchRestaurants, type Restaurant } from "../../lib/places";
import { getCurrentLocation, classifyAccuracy } from "../../lib/location";
import { computeTasteVector, type TasteVector } from "../../lib/taste-vector";
import { distanceKm, formatDistance } from "../../lib/match-score";
import { rankRestaurantsForDiscovery, type RankedRestaurant } from "../../lib/restaurant-ranking";
import { trackImpressions } from "../../lib/recommendation-events";
import { calculatePalateMatchScore, type RestaurantInput } from "../../lib/palate-match-score";
import { RestaurantCompatibilityCard } from "../../components/RestaurantCompatibilityCard";
import { CardSkeleton, Shimmer } from "../../components/Shimmer";

// ============================================================================
// Discover — three sub-tabs only:
//   • Nearby   — sorted by distance
//   • For You  — algorithmic feed (Safe + Stretch combined)
//   • Trending — popular nearby (review count + match-adjusted)
// Plus a search bar at the top. Map lives behind the "Map" pill on Nearby.
// ============================================================================

const NEARBY_RADIUS_M = 2500;
const TOP_PER_TAB = 12;

type SubTab = "nearby" | "for_you" | "trending";

export default function DiscoverTab() {
  const router = useRouter();
  const [tab, setTab] = useState<SubTab>("nearby");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RankedRestaurant[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [hereLoading, setHereLoading] = useState(true);
  const [feedLoading, setFeedLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [vector, setVector] = useState<TasteVector | null>(null);
  const [allNearby, setAllNearby] = useState<RestaurantInput[]>([]);

  const load = useCallback(async () => {
    try {
      setError(null);
      setHereLoading(true);
      const loc = await getCurrentLocation().catch(() => null);
      if (!loc) {
        setError("Turn on location in Settings → Palate.");
        setHereLoading(false); setFeedLoading(false);
        return;
      }
      if (classifyAccuracy(loc.accuracy) === "low") {
        setError("Location signal is fuzzy. Step outside and pull to refresh.");
        setHereLoading(false); setFeedLoading(false);
        return;
      }
      setHere({ lat: loc.lat, lng: loc.lng });
      setHereLoading(false);

      setFeedLoading(true);
      const [nearby, vec] = await Promise.all([
        nearbyRestaurants(loc.lat, loc.lng, NEARBY_RADIUS_M),
        computeTasteVector().catch(() => null),
      ]);
      setVector(vec);
      setAllNearby(nearby.map(toInput));
      setFeedLoading(false);

      // Fire impressions for the visible top
      void trackImpressions(nearby.slice(0, TOP_PER_TAB).map((p) => p.google_place_id), { surface: "discover_for_you" });
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load Discover");
      setHereLoading(false); setFeedLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ---- Search (debounced via submit, not keystroke — keeps it fast) ----
  async function runSearch() {
    if (!query.trim()) { setSearchResults(null); return; }
    setSearching(true);
    try {
      const results = await searchRestaurants(query.trim(), here ?? undefined);
      const ranked = results.map((p) => buildRanked(toInput(p), vector, here));
      setSearchResults(ranked);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  // ---- Tabs derived from allNearby ----
  const nearbyList = useMemo(() => {
    return [...allNearby]
      .map((r) => buildRanked(r, vector, here))
      .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999))
      .slice(0, TOP_PER_TAB);
  }, [allNearby, vector, here]);

  const trendingList = useMemo(() => {
    return [...allNearby]
      .filter((r) => (r.user_rating_count ?? 0) >= 200)
      .sort((a, b) => (b.user_rating_count ?? 0) - (a.user_rating_count ?? 0))
      .slice(0, TOP_PER_TAB)
      .map((r) => buildRanked(r, vector, here));
  }, [allNearby, vector, here]);

  // For You: we use the bucketed ranker (Safe + Stretch combined) — but keep
  // it simple: top-ranked overall, no bucket headers visible.
  const [forYouList, setForYouList] = useState<RankedRestaurant[]>([]);
  useFocusEffect(useCallback(() => {
    if (allNearby.length === 0) return;
    let alive = true;
    rankRestaurantsForDiscovery({
      vector, candidates: allNearby, here: here ?? undefined,
      now: new Date(), perBucket: 8,
    }).then((b) => {
      if (!alive) return;
      const merged = [...b.safe, ...b.stretch];
      const seen = new Set<string>();
      const dedup = merged.filter((r) => {
        if (seen.has(r.google_place_id)) return false;
        seen.add(r.google_place_id); return true;
      });
      setForYouList(dedup.slice(0, TOP_PER_TAB));
    });
    return () => { alive = false; };
  }, [allNearby, vector, here]));

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
        <Spacer size={14} />

        {/* Search bar */}
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search restaurants…"
            placeholderTextColor={colors.mute}
            style={styles.searchInput}
            returnKeyType="search"
            onSubmitEditing={runSearch}
            autoCapitalize="words"
            autoCorrect={false}
          />
          <Pressable onPress={() => router.push("/map")} style={styles.mapPill}>
            <Text style={styles.mapPillText}>Map</Text>
          </Pressable>
        </View>

        {/* Search results take over the page when active */}
        {searchResults !== null ? (
          <View style={{ marginTop: spacing.lg }}>
            <View style={styles.searchHead}>
              <Text style={type.subtitle}>Results</Text>
              <Pressable onPress={() => { setQuery(""); setSearchResults(null); }}>
                <Text style={styles.clear}>Clear</Text>
              </Pressable>
            </View>
            <Spacer size={10} />
            {searching ? (
              <ActivityIndicator color={colors.red} />
            ) : searchResults.length === 0 ? (
              <Text style={[type.small, { lineHeight: 20 }]}>No matches.</Text>
            ) : (
              searchResults.map((r) => (
                <RestaurantCompatibilityCard
                  key={r.google_place_id}
                  restaurant={r}
                  surface="search"
                />
              ))
            )}
          </View>
        ) : (
          <>
            {/* Sub-tabs */}
            <View style={styles.tabs}>
              <SubTabBtn label="Nearby"   active={tab === "nearby"}   onPress={() => setTab("nearby")} />
              <SubTabBtn label="For You"  active={tab === "for_you"}  onPress={() => setTab("for_you")} />
              <SubTabBtn label="Trending" active={tab === "trending"} onPress={() => setTab("trending")} />
            </View>

            <Spacer size={16} />

            {error && (
              <View style={styles.errCard}>
                <Text style={[type.body, { color: colors.mute }]}>{error}</Text>
              </View>
            )}

            {hereLoading || feedLoading ? (
              <>
                <Shimmer height={240} borderRadius={18} />
                <Spacer size={16} />
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
              </>
            ) : (
              <>
                {tab === "nearby"   && <List items={nearbyList}   surface="discover_shelf" emptyMsg="Nothing nearby." />}
                {tab === "for_you"  && <List items={forYouList}   surface="discover_for_you" emptyMsg="Log a few visits and we'll learn." />}
                {tab === "trending" && <List items={trendingList} surface="discover_shelf" emptyMsg="No trending spots near you." />}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function SubTabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function List({ items, surface, emptyMsg }: {
  items: RankedRestaurant[]; surface: any; emptyMsg: string;
}) {
  if (items.length === 0) return <Text style={[type.small, { lineHeight: 20 }]}>{emptyMsg}</Text>;
  return (
    <View>
      {items.map((r) => (
        <RestaurantCompatibilityCard key={r.google_place_id} restaurant={r} surface={surface} />
      ))}
    </View>
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function toInput(p: Restaurant): RestaurantInput {
  return {
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
  };
}

function buildRanked(r: RestaurantInput, vector: TasteVector | null, here: { lat: number; lng: number } | null): RankedRestaurant {
  const match = calculatePalateMatchScore(vector, r, { here: here ?? undefined, now: new Date() });
  const km = (here && r.latitude != null && r.longitude != null)
    ? distanceKm(here, { lat: r.latitude, lng: r.longitude })
    : null;
  return { ...r, match, distanceKm: km };
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { padding: spacing.lg, paddingBottom: 100 },

  searchRow: { flexDirection: "row", gap: 8 },
  searchInput: {
    flex: 1, height: 44, borderRadius: 14,
    borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink,
    backgroundColor: colors.paper,
  },
  mapPill: {
    paddingHorizontal: 16,
    height: 44, borderRadius: 14,
    backgroundColor: colors.ink,
    alignItems: "center", justifyContent: "center",
  },
  mapPillText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  tabs: {
    marginTop: spacing.lg,
    flexDirection: "row", gap: 6,
    padding: 4,
    borderRadius: 14,
    backgroundColor: colors.faint,
  },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center" },
  tabBtnActive: {
    backgroundColor: colors.paper,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  tabText: { fontSize: 13, fontWeight: "600", color: colors.mute },
  tabTextActive: { color: colors.ink },

  searchHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  clear: { color: colors.red, fontSize: 13, fontWeight: "700" },

  errCard: {
    padding: spacing.md, borderRadius: 14,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
});
