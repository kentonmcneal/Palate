import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, TextInput, ActivityIndicator, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import { Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { nearbyRestaurants, searchRestaurants, type Restaurant } from "../../lib/places";
import { getOrFetchNearby } from "../../lib/nearby-cache";
import { StretchPick } from "../../components/StretchPick";
import { MoodRow } from "../../components/MoodRow";
import {
  buildCuisineChips, applyMood, moodFallbackNote, moodContextNote,
  isIntentMood, isSurprise, cuisineLabel,
  type Mood, type MoodChip,
} from "../../lib/mood";
import { loadAnalytics, type CuisineSlice } from "../../lib/analytics-stats";
import {
  cuisinesNear, cuisineCandidates, mergeCuisinePools, type CuisineCount,
} from "../../lib/cuisine-catalogue";
import { supabase } from "../../lib/supabase";
import { listWishlist, type WishlistEntry } from "../../lib/palate-insights";
import { getCurrentLocation, classifyAccuracy } from "../../lib/location";
import { getEffectiveLocation, useBrowsingCity } from "../../lib/browsing-location";
import { LocationPill } from "../../components/LocationPill";
import { computeTasteVector, type TasteVector } from "../../lib/taste-vector";
import { distanceKm, formatDistance } from "../../lib/match-score";
import { trackImpressions } from "../../lib/recommendation-events";
import { filterRecommendable } from "../../lib/recommendation/eligibility";
import { dedupeVenues } from "../../lib/recommendation/dedupe";
import { loadPlacePhotos } from "../../lib/place-photos";
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
// "compat_low" is gone. A control that asks for the restaurants you will like
// LEAST is not a sort anybody wants; it read as a debug affordance that escaped
// into the product.
type SortKey = "compat_high" | "distance" | "stretch";
type FormatFilter = "all" | "casual" | "boutique";

const FILTER_LABEL: Record<FormatFilter, string> = {
  all: "Anything",
  casual: "Casual",
  // Was "Boutique", which is a menu word rather than a filter word — nobody
  // browsing for dinner thinks "I want boutique tonight".
  boutique: "Upscale",
};

// Casual = fast/quick-service or cheap; Boutique = upscale/fine-dining or
// pricey. Applied as a visibility filter over the ranked list — it does not
// change the underlying compatibility scores.
function matchesFormatFilter(r: RankedRestaurant, filter: FormatFilter): boolean {
  if (filter === "all") return true;
  const fmt = (r as any).format_class as string | null | undefined;
  const price = (r as any).price_level as number | null | undefined;
  if (filter === "casual") {
    return fmt === "quick_service" || fmt === "fast_casual" || (price != null && price <= 2);
  }
  return fmt === "fine_dining" || fmt === "casual_dining" || (price != null && price >= 3);
}

const SORT_LABEL: Record<SortKey, string> = {
  compat_high: "Best match",
  distance: "Closest",
  // Was "Stretch", which never said what it stretched. It means deliberately
  // outside your usual pattern, so it should say that.
  stretch: "Something different",
};

export default function DiscoverTab() {
  const router = useRouter();
  // Bumped when photo lookups land, to re-render cards with their images.
  const [, setPhotoTick] = useState(0);
  // A weekly discovery ping deep-links here with ?list=date-night. Hand it
  // straight to the list it promised rather than dropping the user on a
  // generic feed and making them hunt for it.
  const { list: deepLinkList } = useLocalSearchParams<{ list?: string }>();
  useEffect(() => {
    if (!deepLinkList) return;
    router.push({ pathname: "/featured-list/[slug]", params: { slug: String(deepLinkList) } });
    // Clear the param so a tab switch back doesn't reopen it.
    router.setParams({ list: undefined } as never);
  }, [deepLinkList, router]);
  const [tab, setTab] = useState<SubTab>("most_compatible");
  const [sort, setSort] = useState<SortKey>("compat_high");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Same control as Home. Asking "what are you in the mood for" belongs on the
  // browse surface too — Discover could sort by fit and distance but had no way
  // to say "Thai, tonight".
  const [mood, setMood] = useState<Mood>(null);
  const [myCuisines, setMyCuisines] = useState<CuisineSlice[]>([]);
  useEffect(() => {
    let alive = true;
    loadAnalytics("month")
      .then((a) => { if (alive) setMyCuisines(a.cuisineBreakdown); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  // When true, the taste vector is rebuilt from saved (wishlist) restaurants
  // only — recommendations reflect what you've saved, not where you've been.
  const [savesOnly, setSavesOnly] = useState(false);
  const [browsingCity] = useBrowsingCity();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RankedRestaurant[] | null>(null);
  const [searching, setSearching] = useState(false);
  // searchActive flips to true on TextInput focus and stays true until the
  // user taps "Cancel". Drives the suggestion panel ("Find similar to X" +
  // city-wide list) that appears while the query is still empty.
  const [searchActive, setSearchActive] = useState(false);
  const [searchWishlist, setSearchWishlist] = useState<WishlistEntry[]>([]);
  const [searchCityList, setSearchCityList] = useState<CityRestaurant[]>([]);
  const [searchPanelLoading, setSearchPanelLoading] = useState(false);

  const [hereLoading, setHereLoading] = useState(true);
  const [feedLoading, setFeedLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [vector, setVector] = useState<TasteVector | null>(null);
  const [allNearby, setAllNearby] = useState<RestaurantInput[]>([]);
  // Every cuisine that exists within reach, from the catalogue rather than from
  // this 2.5km fetch. Free, and the only way a chip can offer a cuisine that
  // happens to have no venue in the current pool.
  const [catalogueCuisines, setCatalogueCuisines] = useState<CuisineCount[]>([]);
  // Places fetched because a chip asked for a cuisine the pool does not carry.
  const [cataloguePicks, setCataloguePicks] = useState<{ cuisine: string; rows: RestaurantInput[] } | null>(null);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
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
      const { data: { user } } = await supabase.auth.getUser();
      // Taste vector is computed separately (see effect below) so toggling
      // "saves only" recomputes it without refetching nearby places.
      const [nearby, sig, visitedIds] = await Promise.all([
        getOrFetchNearby(loc.lat, loc.lng, NEARBY_RADIUS_M, nearbyRestaurants),
        loadPersonalSignal().catch(() => null),
        user ? loadVisitedPlaceIds(user.id) : Promise.resolve(new Set<string>()),
      ]);

      // Hybrid discovery policy:
      //   - Drop anything the shared eligibility gate rejects (chains, fast
      //     food, airports, hotels — recommendation/eligibility.ts)
      //   - Drop places the user has already visited (saved-shelf and
      //     wishlist-rail live on Home now)
      // dedupeVenues collapses one venue listed twice by Google under
      // different place ids ("Hong Kong Restaurant" + "Hong Kong Restaurant |
      // Chinese") — the duplicate rows a tester saw in this feed.
      const candidates = dedupeVenues(filterRecommendable(nearby)).filter(
        (p) => !visitedIds.has(p.google_place_id),
      );

      setPersonal(sig);
      setAllNearby(candidates.map(toInput));

      // Resolve real photos for the feed in ONE query. Fire-and-forget: the
      // cards render immediately on the gradient and upgrade when this lands.
      void loadPlacePhotos(candidates.slice(0, 40).map((p) => p.google_place_id))
        .then(() => setPhotoTick((t) => t + 1))
        .catch(() => {});
      setFeedLoading(false);

      // Fire impressions for the visible top
      void trackImpressions(candidates.slice(0, TOP_PER_TAB).map((p) => p.google_place_id), { surface: "discover_for_you" });
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load Discover");
      setHereLoading(false); setFeedLoading(false);
    }
  }, [browsingCity]);

  // Re-run load whenever the user picks a different city. (load itself depends
  // on browsingCity now, so the focus effect picks up city changes via its dep.)
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // The search suggestion panel caches its city list for ONE location and the
  // openSearch guard below never refetches. Switching cities therefore left the
  // previous city's restaurants under "All restaurants nearby" while the chip
  // read the new city (reported: chip said Memphis, list was DC). Dropping the
  // cache on a city change makes the next open refetch for the new location.
  useEffect(() => {
    setSearchCityList([]);
  }, [browsingCity?.name]);

  // Compute the taste vector independently of the nearby fetch so the
  // "saves only" toggle re-ranks instantly without another places call.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const vec = await computeTasteVector({ savesOnly }).catch(() => null);
      if (!cancelled) setVector(vec);
    })();
    return () => { cancelled = true; };
  }, [savesOnly]);

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

  // Lazy-load the suggestion panel data the first time the search bar gets
  // focused. Both queries are independent; run them in parallel.
  async function openSearch() {
    setSearchActive(true);
    if (searchPanelLoading) return;
    // The two halves cache INDEPENDENTLY. The wishlist is city-independent and
    // is kept; the city list is dropped on every city change, so it has to be
    // refetchable on its own. The old single guard ("either half is populated
    // => skip") meant a cached wishlist blocked the city list from ever
    // reloading, which is what pinned the nearby list to the previous city.
    const needWishlist = searchWishlist.length === 0;
    const needCity = searchCityList.length === 0 && !!here;
    if (!needWishlist && !needCity) return;

    setSearchPanelLoading(true);
    try {
      await Promise.all([
        needWishlist
          ? listWishlist().then((w) => setSearchWishlist(w.slice(0, 8))).catch(() => {})
          : Promise.resolve(),
        needCity
          ? loadCityRestaurants(here).then(setSearchCityList).catch(() => {})
          : Promise.resolve(),
      ]);
    } finally {
      setSearchPanelLoading(false);
    }
  }

  function closeSearch() {
    setSearchActive(false);
    setQuery("");
    setSearchResults(null);
  }

  // ---- Build canonical taste graph + rank ALL nearby through it ----
  // Per spec: compatibility is calculated ONCE per (user, restaurant). The
  // canonical compatibility cache (in lib/recommendation) makes that true.
  const graph: TasteGraph = useMemo(() => assembleGraph(vector, personal), [vector, personal]);

  const allRanked = useMemo(() => {
    if (!here) return [];
    return allNearby.map((r) => buildRankedRestaurant(graph, r, { here, now: new Date(), mode: "browsing" }));
  }, [allNearby, graph, here]);

  // Apply the Casual/Boutique visibility filter once; all three tabs read
  // from this filtered list so the toggle affects every view consistently.
  const visibleRanked = useMemo(
    () => allRanked.filter((r) => matchesFormatFilter(r, formatFilter)),
    [allRanked, formatFilter],
  );

  // Nearby tab — strict distance sort.
  const nearbyList = useMemo(() => {
    return [...visibleRanked]
      .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999))
      .slice(0, TOP_PER_TAB);
  }, [visibleRanked]);

  // Trending: grouped into Beli-style category shelves ("Top 10 Burgers"…),
  // plus a fallback shelf when category coverage is sparse.
  const trending = useMemo(
    () => buildTrendingGroups(visibleRanked, vector),
    [visibleRanked, vector],
  );

  // Most Compatible — sort by canonical compatibilityScore (per spec, NOT
  // finalScore), with a small time-of-day boost so brunch spots rise on
  // weekend mornings, late_night bars at 11pm, etc. Boost is applied to the
  // sort key only, not the displayed score, to avoid inflating "% match".
  const mostCompatibleSorted = useMemo(() => {
    const now = new Date();
    const occs = currentOccasions(now);
    const keyFor = (r: RankedRestaurant) =>
      r.score.compatibilityScore + timeOfDayBoost(r.occasion_tags ?? null, occs);

    const arr = visibleRanked.map((r) => ({ item: r, sortKey: keyFor(r) }));
    if (sort === "compat_high") {
      arr.sort((a, b) => b.sortKey - a.sortKey);
    } else if (sort === "distance") {
      arr.sort((a, b) => (a.item.distanceKm ?? 999) - (b.item.distanceKm ?? 999));
    } else if (sort === "stretch") {
      // Stretch slot — prefer high-novelty picks adjacent to user pattern.
      arr.sort((a, b) => {
        const aStretch = a.item.score.recommendationType === "stretch" ? 1 : 0;
        const bStretch = b.item.score.recommendationType === "stretch" ? 1 : 0;
        if (aStretch !== bStretch) return bStretch - aStretch;
        return b.sortKey - a.sortKey;
      });
    }
    // Sorted but NOT sliced. Slicing here meant a mood filtered the top twelve
    // rather than the whole ranked pool, so a cuisine that existed nearby but
    // sat at rank 20 reported "nothing matched" and showed the unfiltered list.
    return arr.map((x) => x.item);
  }, [visibleRanked, sort]);

  const mostCompatibleList = useMemo(
    () => mostCompatibleSorted.slice(0, TOP_PER_TAB),
    [mostCompatibleSorted],
  );

  // A mood narrows the already-ranked list; it never re-scores. The candidates
  // carry cuisine_type and format_class, and applyMood reads `cuisine`, so the
  // two are bridged here rather than by loosening the shared helper.
  // Chips come from the union of your habits and what is actually nearby, so a
  // cuisine you have never eaten is still askable. Derived from the pool rather
  // than fetched, or it could never know what is around you.
  const moodChips = useMemo(
    () => buildCuisineChips(myCuisines, mergeCuisinePools(allNearby, catalogueCuisines)),
    [myCuisines, allNearby, catalogueCuisines],
  );

  const moodedList = useMemo(() => {
    const shaped = mostCompatibleSorted.map((r) => ({
      ...r,
      cuisine: (r as any).cuisine_type ?? null,
      format_class: (r as any).format_class ?? null,
    }));
    const { items, matched } = applyMood(shaped, mood, []);

    // The chip asked for a cuisine this pool does not carry, and the catalogue
    // answered. Those rows are ranked on the same graph as everything else on
    // the screen, so the % match beside them means the same thing.
    if (cataloguePicks && mood === cataloguePicks.cuisine) {
      const rows = cataloguePicks.rows.map((r) =>
        buildRankedRestaurant(graph, r, { here: here ?? undefined, now: new Date(), mode: "browsing" }));
      rows.sort((a, b) => b.score.compatibilityScore - a.score.compatibilityScore);
      const best = rows.length > 0 ? Math.round(rows[0].score.compatibilityScore) : null;
      return {
        items: rows.slice(0, TOP_PER_TAB) as typeof mostCompatibleList,
        note: rows.length === 0
          ? moodFallbackNote(mood)
          : moodContextNote(mood, best),
      };
    }

    const top = items.length > 0 ? (items[0] as any)?.score?.compatibilityScore ?? null : null;
    return {
      items: items.slice(0, TOP_PER_TAB) as typeof mostCompatibleList,
      // Two different messages. "Nothing matched, here is everything" when the
      // filter found nobody, versus "these are the best ones and they are not
      // your thing" when it found some and they score low.
      note: mood && !matched
        ? moodFallbackNote(mood)
        : moodContextNote(mood, typeof top === "number" ? Math.round(top) : null),
    };
  }, [mostCompatibleSorted, mood, cataloguePicks, graph, here]);

  // Two catalogue reads, both free, both against rows we already own.
  //
  // The first fills the chip row with every cuisine that exists within reach.
  // The second runs when a chip is tapped and the pool turns out to have none
  // of that cuisine — the case the founder named: ask for steakhouses having
  // never eaten steak, and get steakhouses.
  useEffect(() => {
    if (!here) return;
    let alive = true;
    void cuisinesNear(here.lat, here.lng)
      .then((c) => { if (alive) setCatalogueCuisines(c); })
      .catch(() => {});
    return () => { alive = false; };
  }, [here?.lat, here?.lng]);

  useEffect(() => {
    if (!here) return;
    const isCuisine = typeof mood === "string" && !isIntentMood(mood) && !isSurprise(mood);
    if (!isCuisine) { setCataloguePicks(null); return; }

    const want = String(mood).toLowerCase().trim();
    const inPool = allNearby.some(
      (r) => ((r as any).cuisine_type ?? "").toLowerCase().trim() === want,
    );
    if (inPool) { setCataloguePicks(null); return; }

    let alive = true;
    setCatalogueLoading(true);
    void cuisineCandidates(here, String(mood))
      .then((rows) => {
        if (alive) setCataloguePicks({ cuisine: String(mood), rows: rows as unknown as RestaurantInput[] });
      })
      .catch(() => { if (alive) setCataloguePicks({ cuisine: String(mood), rows: [] }); })
      .finally(() => { if (alive) setCatalogueLoading(false); });
    return () => { alive = false; };
  }, [mood, here?.lat, here?.lng, allNearby]);

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
            onFocus={openSearch}
            autoCapitalize="words"
            autoCorrect={false}
          />
          {searchActive ? (
            <Pressable onPress={closeSearch} style={styles.mapPill}>
              <Text style={styles.mapPillText}>Cancel</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => router.push("/map" as any)} style={styles.mapPill}>
              <Text style={styles.mapPillText}>Map</Text>
            </Pressable>
          )}
        </View>

        {/* Search results take over the page when query has been submitted */}
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
        ) : searchActive && !query ? (
          <SearchSuggestionPanel
            wishlist={searchWishlist}
            cityList={searchCityList}
            loading={searchPanelLoading}
            onSimilarTap={(gpid) => router.push(`/similar/${gpid}` as any)}
            onPlaceTap={(gpid) => router.push(`/restaurant/${gpid}` as any)}
          />
        ) : (
          <>
            {/* (Wishlist rail + "Based on your saves" moved to Home page.
                Discover stays a pure browse/search surface.) */}

            {/* Featured Lists — Beli-style curated rows above the sub-tabs. */}
            <FeaturedLists here={here} city={browsingCity?.name ?? null} vector={vector} personal={personal} />

            {/* Sub-tabs — order: Most Compatible → Trending → Nearby */}
            <View style={styles.tabs}>
              <SubTabBtn label="Most Compatible" active={tab === "most_compatible"} onPress={() => setTab("most_compatible")} />
              <SubTabBtn label="Trending"        active={tab === "trending"}        onPress={() => setTab("trending")} />
              <SubTabBtn label="Nearby"          active={tab === "nearby"}          onPress={() => setTab("nearby")} />
            </View>

            <Spacer size={12} />
            {/* Discover used to stack THREE rows of pills: sub-tabs, then
                All/Casual/Boutique/Saves only, then Highest/Lowest match/
                Closest/Stretch. Twelve controls competing above the first
                restaurant, several of them words nobody would say out loud.
                The sub-tabs are the one contextual row worth keeping visible;
                everything else is behind a single Filters button that says how
                many are on. */}
            <FilterBar
              filter={formatFilter}
              sort={sort}
              savesOnly={savesOnly}
              onOpen={() => setFiltersOpen(true)}
            />

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
                    <MoodRow chips={moodChips} value={mood} onChange={setMood} />
                    {catalogueLoading ? (
                      <Text style={styles.moodNote}>
                        Looking further out for {cuisineLabel(String(mood))}…
                      </Text>
                    ) : !!moodedList.note && (
                      <Text style={styles.moodNote}>{moodedList.note}</Text>
                    )}
                    <Spacer size={10} />
                    {/* One place slightly outside the pattern. It lived on Home
                        until the mood row took that screen over; Discover is
                        where you go to be shown something, so it belongs here.
                        Under the ranked list on purpose — a stretch is what you
                        read after the safe answers, not instead of them. */}
                    <List items={moodedList.items} surface="discover_for_you" emptyMsg="Log a few visits. Once Palate sees a pattern, we'll personalize this list. In the meantime, the Trending tab shows what's hot in your area." />
                    <Spacer size={20} />
                    <Text style={styles.stretchHead}>Stretch your palate</Text>
                    <StretchPick />
                  </>
                )}
                {tab === "trending" && <TrendingGroups groups={trending.groups} fallbackNote={trending.fallbackNote} />}
                {tab === "nearby"   && <List items={nearbyList} surface="discover_shelf" emptyMsg="Nothing nearby." />}
              </>
            )}
          </>
        )}
      </ScrollView>

      <FiltersSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filter={formatFilter}
        onFilter={setFormatFilter}
        sort={sort}
        onSort={setSort}
        savesOnly={savesOnly}
        onSavesOnly={setSavesOnly}
      />
    </SafeAreaView>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

// Returns the occasion_tag values most relevant to the current time. Tags
// match the controlled vocabulary in classifier.ts.
function currentOccasions(now: Date): string[] {
  const h = now.getHours();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const isWeekend = day === 0 || day === 6;
  const occs: string[] = [];
  if (h >= 6 && h < 11) occs.push("breakfast");
  if (h >= 9 && h < 14 && isWeekend) { occs.push("brunch", "weekend_anchor"); }
  if (h >= 11 && h < 15) occs.push("working_lunch");
  if (h >= 17 && h < 22) { occs.push("date_night", "group_dinner"); }
  if (h >= 22 || h < 2) occs.push("late_night");
  return occs;
}

// Sort-only bump (does NOT inflate the displayed compatibilityScore).
// Each matching occasion tag adds 3 points, capped at 8.
function timeOfDayBoost(tags: string[] | null, currentTags: string[]): number {
  if (!tags || currentTags.length === 0) return 0;
  let hits = 0;
  for (const t of currentTags) if (tags.includes(t)) hits += 1;
  return Math.min(hits * 3, 8);
}

// City-restaurants helper for the search suggestion panel — bounding-box
// query over `restaurants_resolved` so we get user-corrected cuisines too,
// ranked by review count. ~12km box at the equator; tightens at higher
// latitudes. 100-row cap keeps the response light.
type CityRestaurant = {
  google_place_id: string;
  name: string;
  cuisine_type: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  price_level: number | null;
  rating: number | null;
  user_rating_count: number | null;
};

async function loadCityRestaurants(here: { lat: number; lng: number }): Promise<CityRestaurant[]> {
  const dLat = 0.1;
  const dLng = 0.13;
  const { data } = await supabase
    .from("restaurants_resolved")
    .select("google_place_id, name, cuisine_type:resolved_cuisine_type, occasion_tags, tags, neighborhood, latitude, longitude, price_level, rating, user_rating_count, recommendation_eligibility")
    .gte("latitude", here.lat - dLat).lte("latitude", here.lat + dLat)
    .gte("longitude", here.lng - dLng).lte("longitude", here.lng + dLng)
    .or("recommendation_eligibility.is.null,recommendation_eligibility.gt.0")
    .order("user_rating_count", { ascending: false, nullsFirst: false })
    .limit(100);
  return ((data ?? []) as any[]).map((r) => ({
    google_place_id: r.google_place_id,
    name: r.name,
    cuisine_type: r.cuisine_type,
    occasion_tags: r.occasion_tags,
    tags: r.tags,
    neighborhood: r.neighborhood,
    latitude: r.latitude,
    longitude: r.longitude,
    price_level: r.price_level,
    rating: r.rating,
    user_rating_count: r.user_rating_count,
  }));
}

// Search-bar suggestion panel — appears when the user taps the search bar
// before they've typed anything. Two sections: "Find places similar to ..."
// (anchored on saves) and "All restaurants nearby" (bounding-box list).
function SearchSuggestionPanel({
  wishlist, cityList, loading, onSimilarTap, onPlaceTap,
}: {
  wishlist: WishlistEntry[];
  cityList: CityRestaurant[];
  loading: boolean;
  onSimilarTap: (googlePlaceId: string) => void;
  onPlaceTap: (googlePlaceId: string) => void;
}) {
  return (
    <View style={{ marginTop: spacing.lg }}>
      {wishlist.length > 0 && (
        <View style={{ marginBottom: spacing.lg }}>
          <Text style={[type.micro, { marginBottom: 10 }]}>FIND PLACES SIMILAR TO…</Text>
          {wishlist.map((w) => {
            const r = w.restaurant;
            if (!r) return null;
            return (
              <Pressable
                key={w.id}
                onPress={() => onSimilarTap(r.google_place_id)}
                style={({ pressed }) => [styles.suggestRow, pressed && { opacity: 0.85 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggestName} numberOfLines={1}>{r.name}</Text>
                  <Text style={styles.suggestSub} numberOfLines={1}>
                    {[r.cuisine_type ? r.cuisine_type[0].toUpperCase() + r.cuisine_type.slice(1) : null, r.neighborhood]
                      .filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <Text style={styles.suggestArrow}>›</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Text style={[type.micro, { marginBottom: 10 }]}>ALL RESTAURANTS NEARBY</Text>
      {loading && cityList.length === 0 ? (
        <ActivityIndicator color={colors.red} />
      ) : cityList.length === 0 ? (
        <Text style={[type.small, { lineHeight: 20 }]}>
          No places indexed yet in this area — start logging visits to fill the map.
        </Text>
      ) : (
        cityList.map((r) => (
          <Pressable
            key={r.google_place_id}
            onPress={() => onPlaceTap(r.google_place_id)}
            style={({ pressed }) => [styles.suggestRow, pressed && { opacity: 0.85 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.suggestName} numberOfLines={1}>{r.name}</Text>
              <Text style={styles.suggestSub} numberOfLines={1}>
                {[
                  r.cuisine_type ? r.cuisine_type[0].toUpperCase() + r.cuisine_type.slice(1) : null,
                  r.neighborhood,
                  r.price_level != null && r.price_level > 0 ? "$".repeat(r.price_level) : null,
                  r.rating != null ? `★ ${r.rating.toFixed(1)}` : null,
                ].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <Text style={styles.suggestArrow}>›</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

// All restaurant ids the user has ever visited, used to hide them from the
// discovery feed. Returns google_place_ids (the feed's natural join key).
async function loadVisitedPlaceIds(userId: string): Promise<Set<string>> {
  try {
    const { data } = await supabase
      .from("visits")
      .select("restaurant:restaurants(google_place_id)")
      .eq("user_id", userId);
    // PostgREST returns the joined object as an array even for many-to-one
    // FKs in some typings; flatten defensively.
    const ids: string[] = [];
    for (const row of (data ?? []) as unknown as Array<{
      restaurant: { google_place_id?: string } | Array<{ google_place_id?: string }> | null;
    }>) {
      const r = row.restaurant;
      if (!r) continue;
      if (Array.isArray(r)) {
        for (const rr of r) if (rr.google_place_id) ids.push(rr.google_place_id);
      } else if (r.google_place_id) {
        ids.push(r.google_place_id);
      }
    }
    return new Set(ids);
  } catch {
    return new Set<string>();
  }
}

function SubTabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

// One control instead of two rows of chips. It states how many filters are on,
// because a filter you have forgotten about is how a browse surface quietly
// stops showing you things and you conclude the app has nothing.
function FilterBar({
  filter, sort, savesOnly, onOpen,
}: {
  filter: FormatFilter;
  sort: SortKey;
  savesOnly: boolean;
  onOpen: () => void;
}) {
  const active =
    (filter !== "all" ? 1 : 0) + (savesOnly ? 1 : 0) + (sort !== "compat_high" ? 1 : 0);
  return (
    <View style={styles.filterBar}>
      <Text style={styles.filterSummary} numberOfLines={1}>
        {SORT_LABEL[sort]}
        {filter !== "all" ? ` · ${FILTER_LABEL[filter]}` : ""}
        {savesOnly ? " · Saved" : ""}
      </Text>
      <Pressable onPress={onOpen} style={styles.filterBtn} accessibilityRole="button">
        <Text style={styles.filterBtnText}>
          {active > 0 ? `Filters · ${active}` : "Filters"}
        </Text>
      </Pressable>
    </View>
  );
}

function FiltersSheet({
  visible, onClose, filter, onFilter, sort, onSort, savesOnly, onSavesOnly,
}: {
  visible: boolean;
  onClose: () => void;
  filter: FormatFilter;
  onFilter: (f: FormatFilter) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  savesOnly: boolean;
  onSavesOnly: (v: boolean) => void;
}) {
  const formats: FormatFilter[] = ["all", "casual", "boutique"];
  const sorts: SortKey[] = ["compat_high", "distance", "stretch"];
  const anyOn = filter !== "all" || savesOnly || sort !== "compat_high";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetScrim} onPress={onClose} accessibilityLabel="Close filters" />
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <Text style={type.title}>Filters</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.sheetDone}>Done</Text>
          </Pressable>
        </View>

        <Text style={styles.sheetLabel}>SORT BY</Text>
        <View style={styles.sheetRow}>
          {sorts.map((k) => (
            <Pressable
              key={k}
              onPress={() => onSort(k)}
              style={[styles.sheetChip, k === sort && styles.sheetChipActive]}
            >
              <Text style={[styles.sheetChipText, k === sort && styles.sheetChipTextActive]}>
                {SORT_LABEL[k]}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sheetLabel}>KIND OF PLACE</Text>
        <View style={styles.sheetRow}>
          {formats.map((k) => (
            <Pressable
              key={k}
              onPress={() => onFilter(k)}
              style={[styles.sheetChip, k === filter && styles.sheetChipActive]}
            >
              <Text style={[styles.sheetChipText, k === filter && styles.sheetChipTextActive]}>
                {FILTER_LABEL[k]}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={() => onSavesOnly(!savesOnly)}
          style={[styles.sheetToggle, savesOnly && styles.sheetChipActive]}
        >
          <Text style={[styles.sheetChipText, savesOnly && styles.sheetChipTextActive]}>
            Only places I've saved
          </Text>
        </Pressable>

        {anyOn && (
          <Pressable
            onPress={() => { onFilter("all"); onSort("compat_high"); onSavesOnly(false); }}
            style={styles.sheetClear}
          >
            <Text style={styles.sheetClearText}>Clear filters</Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

function List({ items, surface, emptyMsg }: {
  items: RankedRestaurant[]; surface: any; emptyMsg: string;
}) {
  if (items.length === 0) {
    return (
      <View style={styles.emptyList}>
        <Text style={styles.emptyListText}>{emptyMsg}</Text>
      </View>
    );
  }
  return (
    <View>
      {items.map((r) => (
        <RestaurantCompatibilityCard key={r.google_place_id} restaurant={r} surface={surface} />
      ))}
    </View>
  );
}

function TrendingGroups({ groups, fallbackNote }: { groups: TrendingGroup[]; fallbackNote?: string | null }) {
  if (groups.length === 0) {
    return (
      <View style={styles.emptyList}>
        <Text style={styles.emptyListText}>Trending near you is still warming up.</Text>
      </View>
    );
  }
  return (
    <View>
      {fallbackNote && (
        <Text style={[type.small, { color: colors.mute, marginBottom: 10, lineHeight: 18 }]}>
          {fallbackNote}
        </Text>
      )}
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
  // Which taste-vector keys imply the user has affinity for this category.
  // Used by hideIrrelevantCategories — once the user has a few visits/saves,
  // shelves with zero weight in any of these keys get suppressed. Optional;
  // a category with no `affinity` is always shown.
  affinity?: {
    regions?: string[];
    subregions?: string[];
    formats?: string[];
    occasions?: string[];
  };
};

// Order matters — first matching category wins (a place is shelved into
// exactly one bucket so the same name doesn't appear under multiple headers).
const CATEGORIES: CategoryDef[] = [
  { title: "Top 10 Burgers",      match: (r) => hasAny(r, ["burger", "burgers"]),
    affinity: { subregions: ["burger"] } },
  { title: "Top 10 Pizza",        match: (r) => hasAny(r, ["pizza", "pizzeria", "italian_pizzeria", "italian_neapolitan", "pizza_nyc", "pizza_chicago"]),
    affinity: { subregions: ["italian_pizzeria", "italian_neapolitan", "pizza_nyc", "pizza_chicago"], regions: ["italian"] } },
  { title: "Top 10 Tacos",        match: (r) => hasAny(r, ["taco", "tacos", "taqueria", "mexican_taqueria", "mexican_regional", "mexican"]),
    affinity: { subregions: ["mexican_taqueria", "mexican_regional", "mexican"], regions: ["latin_american"] } },
  { title: "Top 10 Sushi",        match: (r) => hasAny(r, ["sushi", "japanese_sushi"]),
    affinity: { subregions: ["japanese_sushi"] } },
  { title: "Top 10 Ramen",        match: (r) => hasAny(r, ["ramen", "japanese_ramen"]),
    affinity: { subregions: ["japanese_ramen"] } },
  { title: "Top 10 BBQ",          match: (r) => hasAny(r, ["bbq", "barbecue", "memphis_bbq", "texas_bbq", "kc_bbq"]),
    affinity: { subregions: ["memphis_bbq", "texas_bbq", "kc_bbq", "bbq_general"], regions: ["southern_us"] } },
  { title: "Top 10 Steakhouses",  match: (r) => hasAny(r, ["steak", "steakhouse"]),
    affinity: { subregions: ["steakhouse"] } },
  { title: "Top Cafés",           match: (r) => r.format_class === "café" || hasAny(r, ["café", "cafe", "coffee"]),
    affinity: { formats: ["café"], regions: ["café_culture"] } },
  { title: "Top Wine Bars",       match: (r) => r.format_class === "wine_bar" || hasAny(r, ["wine_bar", "wine bar"]),
    affinity: { formats: ["wine_bar"], subregions: ["wine_bar_food"] } },
  { title: "Top 10 Thai",         match: (r) => hasAny(r, ["thai"]),
    affinity: { subregions: ["thai"] } },
  { title: "Top 10 Korean",       match: (r) => hasAny(r, ["korean", "korean_bbq"]),
    affinity: { subregions: ["korean", "korean_bbq"] } },
  { title: "Top 10 Indian",       match: (r) => hasAny(r, ["indian", "indian_north", "indian_south"]),
    affinity: { subregions: ["indian_north", "indian_south", "pakistani"], regions: ["south_asian"] } },
  { title: "Top 10 Mediterranean", match: (r) => hasAny(r, ["mediterranean", "greek", "turkish", "lebanese", "israeli", "moroccan"]),
    affinity: { subregions: ["greek", "turkish", "lebanese", "israeli", "moroccan", "mediterranean_general"], regions: ["mediterranean", "middle_eastern"] } },
  { title: "Top 10 Brunch",       match: (r) => hasOccasion(r, "brunch") || hasAny(r, ["brunch_modern", "breakfast_diner"]),
    affinity: { subregions: ["brunch_modern", "breakfast_diner"], occasions: ["brunch", "weekend_anchor"] } },
];

// Once a user has logged enough activity, suppress trending shelves they
// have zero recorded affinity for. Below the threshold we show everything
// (cold-start users get the full smörgåsbord). The "objective consensus
// ordering inside each shelf is unchanged — this only trims WHICH shelves
// the user sees.
const TRENDING_AFFINITY_MIN_ACTIVITY = 5;

function hasCategoryAffinity(cat: CategoryDef, v: TasteVector | null): boolean {
  if (!cat.affinity) return true;
  if (!v) return true;
  if ((v.visitCount + v.wishlistCount) < TRENDING_AFFINITY_MIN_ACTIVITY) return true;
  const a = cat.affinity;
  const sum = (keys: string[] | undefined, weights: Record<string, number>) =>
    (keys ?? []).reduce((s, k) => s + (weights[k] ?? 0), 0);
  const total =
    sum(a.regions,    v.cuisineRegion)
    + sum(a.subregions, v.cuisineSubregion)
    + sum(a.formats,    v.formatClass)
    + sum(a.occasions,  v.occasion);
  return total > 0;
}

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

type TrendingResult = { groups: TrendingGroup[]; fallbackNote: string | null };

function buildTrendingGroups(
  allRanked: RankedRestaurant[],
  vector: TasteVector | null,
): TrendingResult {
  // Try real category trending first (Beli-style shelves). Only filter on
  // user_rating_count when we actually have ratings — Google sometimes returns
  // places with null counts.
  const popular = allRanked.filter((r) => (r.user_rating_count ?? 0) >= 25);

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
    if (items.length < 2) continue;
    // Past cold-start, drop shelves the user has zero recorded affinity for.
    // The shelf's INTERNAL ranking is unchanged — this only filters whether
    // the shelf appears at all.
    if (!hasCategoryAffinity(cat, vector)) continue;
    items.sort((a, b) => {
      const aRev = a.user_rating_count ?? 0;
      const bRev = b.user_rating_count ?? 0;
      const popDiff = Math.log10(1 + bRev) - Math.log10(1 + aRev);
      const compatDiff = (b.score.compatibilityScore - a.score.compatibilityScore) / 100;
      return popDiff * 0.6 + compatDiff * 0.4;
    });
    groups.push({ title: cat.title, items: items.slice(0, TOP_PER_CATEGORY) });
  }

  if (groups.length > 0) return { groups, fallbackNote: null };

  // Fallback: not enough category coverage. Show a single "Trending Near You"
  // shelf ranked by review-weighted quality + open-now + proximity, so the
  // tab is never empty when there are nearby places.
  const ranked = rankFallbackTrending(allRanked);
  if (ranked.length === 0) return { groups: [], fallbackNote: null };

  return {
    groups: [{ title: "Popular near you", items: ranked.slice(0, TOP_PER_TAB) }],
    fallbackNote: "Strong picks nearby. Category shelves unlock as more people log in your area.",
  };
}

function rankFallbackTrending(items: RankedRestaurant[]): RankedRestaurant[] {
  // Quality-first ranking when category trending is empty:
  //   • rating
  //   • review count (log-scaled — popular places trump tiny ones)
  //   • open-now (small bonus — only when known)
  //   • distance (small penalty for being far)
  return [...items]
    .filter((r) => (r.rating ?? 0) > 0 || (r.user_rating_count ?? 0) > 0 || r.distanceKm != null)
    .sort((a, b) => fallbackScore(b) - fallbackScore(a));
}

function fallbackScore(r: RankedRestaurant): number {
  const rating = r.rating ?? 0;
  const reviews = Math.log10(1 + (r.user_rating_count ?? 0));
  const dist = r.distanceKm ?? 5;
  const open = (r as any).isOpenNow === true ? 0.3 : 0;
  // Rating is the dominant axis. Reviews ground it. Distance only barely
  // de-prioritizes — the user is ALREADY scoped to nearby radius.
  return rating * 1.0 + reviews * 0.5 + open - Math.min(dist, 3) * 0.05;
}

const styles = StyleSheet.create({
  moodNote: { ...type.small, marginTop: 10, lineHeight: 17 },
  stretchHead: {
    fontSize: 17, fontWeight: "800", color: colors.ink,
    letterSpacing: -0.3, marginBottom: 10,
  },
  filterBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12,
  },
  filterSummary: { ...type.small, flex: 1 },
  filterBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  filterBtnText: { fontSize: 13, fontWeight: "800", color: colors.ink },

  sheetScrim: { flex: 1, backgroundColor: "rgba(15,15,15,0.4)" },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, paddingBottom: 40,
  },
  sheetHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  sheetDone: { fontSize: 15, fontWeight: "800", color: colors.red },
  sheetLabel: { ...type.micro, marginTop: spacing.md, marginBottom: 8 },
  sheetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sheetChip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  sheetChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  sheetChipText: { fontSize: 13, fontWeight: "700", color: colors.mute },
  sheetChipTextActive: { color: "#fff" },
  sheetToggle: {
    marginTop: spacing.lg, paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 14, backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line, alignItems: "center",
  },
  sheetClear: { marginTop: spacing.md, paddingVertical: 10, alignItems: "center" },
  sheetClearText: { fontSize: 14, fontWeight: "700", color: colors.mute },
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
    minHeight: 44, paddingVertical: 8, borderRadius: 14,
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
  clear: { color: colors.redText, fontSize: 13, fontWeight: "700" },

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
  filterDivider: { width: 1, alignSelf: "stretch", marginVertical: 4, backgroundColor: colors.line },

  emptyList: {
    padding: spacing.lg,
    borderRadius: 16,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  emptyListText: { ...type.small, lineHeight: 20 },
  suggestRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  suggestName: { fontSize: 15, fontWeight: "600", color: colors.ink, letterSpacing: -0.2 },
  suggestSub: { fontSize: 12, color: colors.mute, marginTop: 2 },
  suggestArrow: { fontSize: 20, color: colors.mute, marginLeft: 12 },
});
