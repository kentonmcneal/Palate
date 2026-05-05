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
import { getEffectiveLocation, useBrowsingCity } from "../../lib/browsing-location";
import { LocationPill } from "../../components/LocationPill";
import { computeTasteVector, type TasteVector } from "../../lib/taste-vector";
import { distanceKm, formatDistance } from "../../lib/match-score";
import { trackImpressions } from "../../lib/recommendation-events";
import { RestaurantCompatibilityCard } from "../../components/RestaurantCompatibilityCard";
import { CardSkeleton, Shimmer } from "../../components/Shimmer";
import { FeaturedLists } from "../../components/FeaturedLists";
import { loadPersonalSignal, type PersonalSignal } from "../../lib/personal-signal";
import {
  assembleGraph, buildRankedRestaurant, generateCandidates,
  type TasteGraph, type RankedRestaurant, type RestaurantInput,
} from "../../lib/recommendation";

// ============================================================================
// Discover — three sub-tabs:
//   • Most Compatible — ranked high → low by palate fit
//   • Trending        — Beli-style grouped category lists ("Top 10 Burgers"…)
//   • Nearby          — sorted by distance
// Search bar at top. Map lives behind the "Map" pill.
// ============================================================================

const NEARBY_RADIUS_M = 2500;
const TOP_PER_TAB = 12;
const TOP_PER_CATEGORY = 10;
const MIN_PER_CATEGORY = 3;

type SubTab = "most_compatible" | "trending" | "nearby";
type SortKey = "compat_high" | "compat_low" | "distance" | "stretch";

const SORT_LABEL: Record<SortKey, string> = {
  compat_high: "Highest match",
  compat_low: "Lowest match",
  distance: "Closest",
  stretch: "Stretch",
};

export default function DiscoverTab() {
  const router = useRouter();
  const [tab, setTab] = useState<SubTab>("most_compatible");
  const [sort, setSort] = useState<SortKey>("compat_high");
  const [browsingCity] = useBrowsingCity();
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
  const [personal, setPersonal] = useState<PersonalSignal | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setHereLoading(true);
      // Browse-side queries respect the location override (city picker).
      // Real GPS is the fallback.
      const loc = await getEffectiveLocation().catch(() => null);
      if (!loc) {
        setError("Turn on location in Settings → Palate, or pick a city to browse.");
        setHereLoading(false); setFeedLoading(false);
        return;
      }
      // Skip the accuracy gate when the user has explicitly picked a city.
      if (!browsingCity && classifyAccuracy((loc as any).accuracy) === "low") {
        setError("Location signal is fuzzy. Step outside and pull to refresh.");
        setHereLoading(false); setFeedLoading(false);
        return;
      }
      setHere({ lat: loc.lat, lng: loc.lng });
      setHereLoading(false);

      setFeedLoading(true);
      const [nearby, vec, sig] = await Promise.all([
        nearbyRestaurants(loc.lat, loc.lng, NEARBY_RADIUS_M),
        computeTasteVector().catch(() => null),
        loadPersonalSignal().catch(() => null),
      ]);
      setVector(vec);
      setPersonal(sig);
      setAllNearby(nearby.map(toInput));
      setFeedLoading(false);

      // Fire impressions for the visible top
      void trackImpressions(nearby.slice(0, TOP_PER_TAB).map((p) => p.google_place_id), { surface: "discover_for_you" });
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load Discover");
      setHereLoading(false); setFeedLoading(false);
    }
  }, []);

  // Re-run load whenever the user picks a different city.
  useFocusEffect(useCallback(() => { load(); }, [load, browsingCity?.id]));

  // ---- Search (debounced via submit, not keystroke — keeps it fast) ----
  async function runSearch() {
    if (!query.trim()) { setSearchResults(null); return; }
    setSearching(true);
    try {
      const results = await searchRestaurants(query.trim(), here ?? undefined);
      const ranked = results.map((p) => buildRankedRestaurant(graph, toInput(p), { here: here ?? undefined, now: new Date() }));
      setSearchResults(ranked);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  // ---- Build canonical taste graph + rank ALL nearby through it ----
  // Per spec: compatibility is calculated ONCE per (user, restaurant). The
  // canonical compatibility cache (in lib/recommendation) makes that true.
  const graph: TasteGraph = useMemo(() => assembleGraph(vector, personal), [vector, personal]);

  const allRanked = useMemo(() => {
    if (!here) return [];
    return allNearby.map((r) => buildRankedRestaurant(graph, r, { here, now: new Date(), mode: "browsing" }));
  }, [allNearby, graph, here]);

  // Nearby tab — strict distance sort.
  const nearbyList = useMemo(() => {
    return [...allRanked]
      .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999))
      .slice(0, TOP_PER_TAB);
  }, [allRanked]);

  // Trending: grouped into Beli-style category shelves ("Top 10 Burgers"…)
  const trendingGroups = useMemo(
    () => buildTrendingGroups(allRanked),
    [allRanked],
  );

  // Most Compatible — sort by canonical compatibilityScore (per spec, NOT finalScore).
  const mostCompatibleList = useMemo(() => {
    const arr = [...allRanked];
    if (sort === "compat_high") {
      arr.sort((a, b) => b.score.compatibilityScore - a.score.compatibilityScore);
    } else if (sort === "compat_low") {
      arr.sort((a, b) => a.score.compatibilityScore - b.score.compatibilityScore);
    } else if (sort === "distance") {
      arr.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    } else if (sort === "stretch") {
      // Stretch slot — prefer high-novelty picks adjacent to user pattern.
      arr.sort((a, b) => {
        const aStretch = a.score.recommendationType === "stretch" ? 1 : 0;
        const bStretch = b.score.recommendationType === "stretch" ? 1 : 0;
        if (aStretch !== bStretch) return bStretch - aStretch;
        return b.score.compatibilityScore - a.score.compatibilityScore;
      });
    }
    return arr.slice(0, TOP_PER_TAB);
  }, [allRanked, sort]);

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
        <View style={styles.titleRow}>
          <Text style={type.title}>Discover</Text>
          <LocationPill />
        </View>
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
            {/* Featured Lists — Beli-style curated rows above the sub-tabs. */}
            <FeaturedLists here={here} city={browsingCity?.name ?? null} vector={vector} personal={personal} />

            {/* Sub-tabs — order: Most Compatible → Trending → Nearby */}
            <View style={styles.tabs}>
              <SubTabBtn label="Most Compatible" active={tab === "most_compatible"} onPress={() => setTab("most_compatible")} />
              <SubTabBtn label="Trending"        active={tab === "trending"}        onPress={() => setTab("trending")} />
              <SubTabBtn label="Nearby"          active={tab === "nearby"}          onPress={() => setTab("nearby")} />
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
                {tab === "most_compatible" && (
                  <>
                    <SortRow value={sort} onChange={setSort} />
                    <Spacer size={10} />
                    <List items={mostCompatibleList} surface="discover_for_you" emptyMsg="Log a few visits and we'll learn." />
                  </>
                )}
                {tab === "trending" && <TrendingGroups groups={trendingGroups} />}
                {tab === "nearby"   && <List items={nearbyList} surface="discover_shelf" emptyMsg="Nothing nearby." />}
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

function SortRow({ value, onChange }: { value: SortKey; onChange: (k: SortKey) => void }) {
  const order: SortKey[] = ["compat_high", "compat_low", "distance", "stretch"];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow}>
      {order.map((k) => {
        const active = k === value;
        return (
          <Pressable key={k} onPress={() => onChange(k)} style={[styles.sortChip, active && styles.sortChipActive]}>
            <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>{SORT_LABEL[k]}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
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

function TrendingGroups({ groups }: { groups: TrendingGroup[] }) {
  if (groups.length === 0) {
    return <Text style={[type.small, { lineHeight: 20 }]}>No trending categories near you yet.</Text>;
  }
  return (
    <View>
      {groups.map((g) => (
        <View key={g.title} style={{ marginBottom: spacing.xl }}>
          <Text style={styles.groupHead}>{g.title}</Text>
          <Spacer size={10} />
          {g.items.map((r) => (
            <RestaurantCompatibilityCard key={r.google_place_id} restaurant={r} surface="discover_shelf" />
          ))}
        </View>
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

// ----------------------------------------------------------------------------
// Trending categorization — Beli-style grouped lists.
// ----------------------------------------------------------------------------

type TrendingGroup = { title: string; items: RankedRestaurant[] };

type CategoryDef = {
  title: string;                              // "Top 10 Burgers"
  match: (r: RestaurantInput) => boolean;
};

// Order matters — first matching category wins (a place is shelved into
// exactly one bucket so the same name doesn't appear under multiple headers).
const CATEGORIES: CategoryDef[] = [
  { title: "Top 10 Burgers",      match: (r) => hasAny(r, ["burger", "burgers"]) },
  { title: "Top 10 Pizza",        match: (r) => hasAny(r, ["pizza", "pizzeria", "italian_pizzeria", "italian_neapolitan", "pizza_nyc", "pizza_chicago"]) },
  { title: "Top 10 Tacos",        match: (r) => hasAny(r, ["taco", "tacos", "taqueria", "mexican_taqueria", "mexican_regional", "mexican"]) },
  { title: "Top 10 Sushi",        match: (r) => hasAny(r, ["sushi", "japanese_sushi"]) },
  { title: "Top 10 Ramen",        match: (r) => hasAny(r, ["ramen", "japanese_ramen"]) },
  { title: "Top 10 BBQ",          match: (r) => hasAny(r, ["bbq", "barbecue", "memphis_bbq", "texas_bbq", "kc_bbq"]) },
  { title: "Top 10 Steakhouses",  match: (r) => hasAny(r, ["steak", "steakhouse"]) },
  { title: "Top Cafés",           match: (r) => r.format_class === "café" || hasAny(r, ["café", "cafe", "coffee"]) },
  { title: "Top Wine Bars",       match: (r) => r.format_class === "wine_bar" || hasAny(r, ["wine_bar", "wine bar"]) },
  { title: "Top 10 Thai",         match: (r) => hasAny(r, ["thai"]) },
  { title: "Top 10 Korean",       match: (r) => hasAny(r, ["korean", "korean_bbq"]) },
  { title: "Top 10 Indian",       match: (r) => hasAny(r, ["indian", "indian_north", "indian_south"]) },
  { title: "Top 10 Mediterranean", match: (r) => hasAny(r, ["mediterranean", "greek", "turkish", "lebanese", "israeli", "moroccan"]) },
  { title: "Top 10 Brunch",       match: (r) => hasOccasion(r, "brunch") || hasAny(r, ["brunch_modern", "breakfast_diner"]) },
];

function hasAny(r: RestaurantInput, needles: string[]): boolean {
  // Include the restaurant name as a fallback — Google Places cuisine tags
  // are missing on many spots, so "Joe's Burgers" should still hit Burgers.
  const fields = [
    r.cuisine_type, r.cuisine_subregion, r.cuisine_region,
    r.format_class, (r as any).name,
  ].filter(Boolean) as string[];
  const hay = fields.join(" ").toLowerCase();
  return needles.some((n) => hay.includes(n.toLowerCase()));
}

function hasOccasion(r: RestaurantInput, tag: string): boolean {
  return Array.isArray(r.occasion_tags) && r.occasion_tags.includes(tag);
}

function buildTrendingGroups(allRanked: RankedRestaurant[]): TrendingGroup[] {
  // Lowered the social-proof bar (was 100) — at the bar level, many cuisine
  // categories were dropping below MIN. With 25 we still filter out totally
  // unreviewed places but new spots and small joints can compete.
  const popular = allRanked.filter((r) => (r.user_rating_count ?? 0) >= 25);

  // Bucket each place into the FIRST matching category so we don't double-show.
  const buckets = new Map<string, RankedRestaurant[]>();
  for (const r of popular) {
    const cat = CATEGORIES.find((c) => c.match(r));
    if (!cat) continue;
    const arr = buckets.get(cat.title) ?? [];
    arr.push(r);
    buckets.set(cat.title, arr);
  }

  const groups: TrendingGroup[] = [];
  for (const cat of CATEGORIES) {
    const items = buckets.get(cat.title) ?? [];
    // Lowered MIN to 2 (was MIN_PER_CATEGORY=3) — many neighborhoods don't
    // have 3 of every category, but 2 still feels like a "list" not noise.
    if (items.length < 2) continue;
    // Within each category: blend popularity with canonical compatibility
    // (per spec — Trending lists should still respect taste fit, not just
    // raw review count).
    items.sort((a, b) => {
      const aRev = a.user_rating_count ?? 0;
      const bRev = b.user_rating_count ?? 0;
      const popDiff = Math.log10(1 + bRev) - Math.log10(1 + aRev);
      const compatDiff = (b.score.compatibilityScore - a.score.compatibilityScore) / 100;
      return popDiff * 0.6 + compatDiff * 0.4;
    });
    groups.push({
      title: cat.title,
      items: items.slice(0, TOP_PER_CATEGORY),
    });
  }
  return groups;
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

  groupHead: { fontSize: 17, fontWeight: "800", color: colors.ink, letterSpacing: -0.3 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },

  sortRow: { gap: 8, paddingRight: spacing.lg },
  sortChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  sortChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  sortChipText: { fontSize: 12, fontWeight: "700", color: colors.ink },
  sortChipTextActive: { color: "#fff" },
});
