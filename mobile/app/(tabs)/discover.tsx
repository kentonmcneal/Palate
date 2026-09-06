import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { View, StyleSheet, Pressable, RefreshControl, ActivityIndicator, Modal } from "react-native";
import { TextInput } from "../../components/TextInput";
import { Text } from "../../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import { Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { nearbyRestaurants, searchRestaurants, searchRestaurantsLocal, type Restaurant } from "../../lib/places";
import { useSuggestions } from "../../lib/use-suggestions";
import { getOrFetchNearby } from "../../lib/nearby-cache";
import { StretchPick } from "../../components/StretchPick";
import { MoodRow } from "../../components/MoodRow";
import {
  buildDishChips, applyMood, moodFallbackNote, moodContextNote,
  isIntentMood, isSurprise, isDishMood, dishOf, moodLabel,
  type Mood, type MoodChip,
} from "../../lib/mood";
import { loadAnalytics, type CuisineSlice } from "../../lib/analytics-stats";
import {
  cuisinesNear, cuisineCandidates, dishesNear, dishCandidates, mergeCuisinePools, restaurantsNear,
  type CuisineCount, type DishCount,
} from "../../lib/cuisine-catalogue";
import { supabase } from "../../lib/supabase";
import { listWishlist, type WishlistEntry } from "../../lib/palate-insights";
import { getCurrentLocation, classifyAccuracy } from "../../lib/location";
import { getEffectiveLocation, useBrowsingCity } from "../../lib/browsing-location";
import { LocationPill } from "../../components/LocationPill";
import { computeTasteVector, type TasteVector } from "../../lib/taste-vector";
import { distanceKm, formatDistance } from "../../lib/match-score";
import { newRequestId } from "../../lib/recommendation-events";
import { ImpressionScrollView } from "../../components/Impressions";
import { filterRecommendable } from "../../lib/recommendation/eligibility";
import { isStretch } from "../../lib/recommendation";
import { dedupeVenues } from "../../lib/recommendation/dedupe";
import { loadPlacePhotos } from "../../lib/place-photos";
import { RestaurantCompatibilityCard } from "../../components/RestaurantCompatibilityCard";
import { CardSkeleton, Shimmer } from "../../components/Shimmer";
import { loadPersonalSignal, type PersonalSignal } from "../../lib/personal-signal";
import {
  assembleGraph, buildRankedRestaurant, generateCandidates,
  type TasteGraph, type RankedRestaurant, type RestaurantInput,
} from "../../lib/recommendation";

// ============================================================================
// Discover — three sub-tabs:
//   • Most Compatible — ranked high → low by palate fit
//   • Stretch         — places outside your pattern that still connect to it
//   • Nearby          — sorted by distance
// Search bar at top. Map lives behind the "Map" pill.
// ============================================================================

const NEARBY_RADIUS_M = 2500;
const TOP_PER_TAB = 12;
const TOP_PER_CATEGORY = 10;
const MIN_PER_CATEGORY = 3;

type SubTab = "most_compatible" | "stretch" | "nearby";
// "compat_low" is gone. A control that asks for the restaurants you will like
// LEAST is not a sort anybody wants; it read as a debug affordance that escaped
// into the product.


// Casual = fast/quick-service or cheap; Boutique = upscale/fine-dining or
// pricey. Applied as a visibility filter over the ranked list — it does not
// change the underlying compatibility scores.


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
  // Same control as Home. Asking "what are you in the mood for" belongs on the
  // browse surface too — Discover could sort by fit and distance but had no way
  // to say "Thai, tonight".
  const [mood, setMood] = useState<Mood>(null);
  const requestIdRef = useRef(newRequestId());
  const [myCuisines, setMyCuisines] = useState<CuisineSlice[]>([]);
  useEffect(() => {
    let alive = true;
    loadAnalytics("month")
      .then((a) => { if (alive) setMyCuisines(a.cuisineBreakdown); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  // When true, the taste vector is rebuilt from saved (wishlist) restaurants
  // only — recommendations reflect what you've saved, not where you've been.
  const [browsingCity] = useBrowsingCity();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RankedRestaurant[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
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
  const [catalogueDishes, setCatalogueDishes] = useState<DishCount[]>([]);
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
      const [googleNearby, catalogueNearby, sig, visitedIds] = await Promise.all([
        getOrFetchNearby(loc.lat, loc.lng, NEARBY_RADIUS_M, nearbyRestaurants),
        // The catalogue within 5km, free. One 20-result Google call minus
        // chains minus places you have been left a handful; the shelves
        // never formed. Google rows come first (they are fresher), the
        // catalogue fills in behind them by place id.
        restaurantsNear({ lat: loc.lat, lng: loc.lng }, { radiusM: 5000, limit: 150 }).catch(() => [] as Restaurant[]),
        loadPersonalSignal().catch(() => null),
        user ? loadVisitedPlaceIds(user.id) : Promise.resolve(new Set<string>()),
      ]);
      const seenIds = new Set(googleNearby.map((p) => p.google_place_id));
      const nearby = [...googleNearby, ...catalogueNearby.filter((p) => !seenIds.has(p.google_place_id))];

      // Hybrid discovery policy:
      //   - Drop anything the shared eligibility gate rejects (chains, fast
      //     food, airports, hotels — recommendation/eligibility.ts)
      //   - Drop places the user has already visited (saved-shelf and
      //     wishlist-rail live on Home now)
      // dedupeVenues collapses one venue listed twice by Google under
      // different place ids ("Hong Kong Restaurant" + "Hong Kong Restaurant |
      // Chinese") — the duplicate rows a tester saw in this feed.
      const candidates = dedupeVenues(filterRecommendable(nearby, { hidden: sig?.dislikes.placeIds ?? null })).filter(
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

      // A new ranking pass. Impressions fire from the cards themselves when
      // they are actually on screen (components/Impressions.tsx), never here.
      requestIdRef.current = newRequestId();
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load Discover");
      setHereLoading(false); setFeedLoading(false);
    }
  }, [browsingCity]);

  // Re-run load whenever the user picks a different city. (load itself depends
  // on browsingCity now, so the focus effect picks up city changes via its dep.)
  useFocusEffect(useCallback(() => { load(); }, [load]));
  // A city switch must not show the old city's cards with recomputed
  // distances while the new fetch runs.
  useEffect(() => { setAllNearby([]); setCataloguePicks(null); }, [browsingCity?.id]);

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
      const vec = await computeTasteVector().catch(() => null);
      if (!cancelled) setVector(vec);
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- Search (debounced via submit, not keystroke — keeps it fast) ----
  async function runSearch() {
    if (!query.trim()) { setSearchResults(null); return; }
    setSearching(true);
    try {
      setSearchFailed(false);
      const results = await searchRestaurants(query.trim(), here ?? undefined);
      const ranked = results
        .filter((p) => !personal?.dislikes.placeIds.has(p.google_place_id) && !hiddenIds.has(p.google_place_id))
        .map((p) => buildRankedRestaurant(graph, toInput(p), { here: here ?? undefined, now: new Date() }));
      setSearchResults(ranked);
    } catch {
      // A failed request is not "this restaurant does not exist".
      setSearchResults([]);
      setSearchFailed(true);
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
          ? loadCityRestaurants(here)
              .then((list) => setSearchCityList(list.filter((r) => !personal?.dislikes.placeIds.has(r.google_place_id) && !hiddenIds.has(r.google_place_id))))
              .catch(() => {})
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

  // Hidden this session from any card on any tab. Every tab reads allRanked,
  // so filtering here removes the place everywhere at once; the personal
  // signal carries it permanently from the next load.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  // Suggestions as you type, from the catalogue we already hold. FREE — one
  // Postgres query. runSearch below goes to Google and bills per call, so it
  // stays on the explicit submit; a keystroke is not a decision to spend.
  const suggestLocal = useCallback(
    async (q: string) => {
      const rows = await searchRestaurantsLocal(q, here ?? undefined, 8);
      return rows
        .filter((p) => !personal?.dislikes.placeIds.has(p.google_place_id) && !hiddenIds.has(p.google_place_id))
        .map((p) => buildRankedRestaurant(graph, toInput(p), { here: here ?? undefined, now: new Date() }));
    },
    [here?.lat, here?.lng, graph, personal, hiddenIds],
  );
  const { suggestions, loading: suggesting } = useSuggestions<RankedRestaurant>(query, suggestLocal);
  const hideId = useCallback((id: string) => setHiddenIds((s) => new Set(s).add(id)), []);
  const allRanked = useMemo(() => {
    if (!here) return [];
    return allNearby
      .filter((r) => !hiddenIds.has(r.google_place_id) && !personal?.dislikes.placeIds.has(r.google_place_id))
      .map((r) => buildRankedRestaurant(graph, r, { here, now: new Date(), mode: "browsing" }));
  }, [allNearby, graph, here, hiddenIds, personal]);

  // Was filtered by a Casual/Boutique toggle. The filters are gone: three
  // tabs already say what each list is, and a filter somebody has forgotten
  // about is how a browse surface quietly stops showing things and the user
  // concludes the app has nothing.
  const visibleRanked = allRanked;

  // Nearby tab — strict distance sort, with the same mood chips as Most
  // Compatible. The mood is filtered BEFORE the cut to TOP_PER_TAB: cutting
  // first and then asking for Thai would answer from the thirty closest
  // places, not the closest Thai. No catalogue fallback here on purpose —
  // "nearby" is the whole promise of the tab.
  const nearbyList = useMemo(() => {
    const sorted = [...visibleRanked]
      .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999))
      .map((r) => ({
        ...r,
        cuisine: (r as any).cuisine_type ?? null,
        format_class: (r as any).format_class ?? null,
        dish_family: (r as any).dish_family ?? null,
      }));
    const { items, matched } = applyMood(sorted, mood, []);
    return {
      items: items.slice(0, TOP_PER_TAB),
      note: mood && !matched ? moodFallbackNote(mood) : null,
    };
  }, [visibleRanked, mood]);

  // Stretch — genuinely outside the pattern, and genuinely connected to it.
  //
  // This replaced Trending, which was category shelves ("Top 10 Burgers")
  // built from the same ranked list as every other tab: a relabelling of what
  // Most Compatible already showed. Stretch sources differently. isStretch
  // (lib/recommendation/candidates.ts) is the SAME predicate the candidate
  // pools use, exported rather than reimplemented, because two definitions of
  // "stretch" that drift apart is how a tab ends up showing something else
  // under a new label.
  //
  // Ordered by compatibility WITHIN the stretch set, so it is the best of the
  // unfamiliar rather than the most unfamiliar — the point is somewhere you
  // would enjoy and would not have chosen, not somewhere random.
  const stretchList = useMemo(() => {
    if (!graph) return [];
    return visibleRanked
      .filter((r) => isStretch(graph, r as never))
      .sort((a, b) => b.score.compatibilityScore - a.score.compatibilityScore)
      .slice(0, TOP_PER_TAB);
  }, [visibleRanked, graph]);

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
    arr.sort((a, b) => b.sortKey - a.sortKey);
    // Sorted but NOT sliced. Slicing here meant a mood filtered the top twelve
    // rather than the whole ranked pool, so a cuisine that existed nearby but
    // sat at rank 20 reported "nothing matched" and showed the unfiltered list.
    return arr.map((x) => x.item);
  }, [visibleRanked]);

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
    () => buildDishChips(myCuisines, mergeCuisinePools(allNearby, catalogueCuisines), catalogueDishes),
    [myCuisines, allNearby, catalogueCuisines, catalogueDishes],
  );

  const moodedList = useMemo(() => {
    const shaped = mostCompatibleSorted.map((r) => ({
      ...r,
      cuisine: (r as any).cuisine_type ?? null,
      format_class: (r as any).format_class ?? null,
      dish_family: (r as any).dish_family ?? null,
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
    void dishesNear(here.lat, here.lng)
      .then((d) => { if (alive) setCatalogueDishes(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [here?.lat, here?.lng]);

  useEffect(() => {
    if (!here) return;
    const isCuisine = typeof mood === "string" && !isIntentMood(mood) && !isSurprise(mood);
    if (!isCuisine) { setCataloguePicks(null); return; }

    const want = (isDishMood(mood) ? dishOf(mood) ?? "" : String(mood)).toLowerCase().trim();
    const inPool = allNearby.some((r) => isDishMood(mood)
      ? (((r as any).dish_family ?? []) as string[]).includes(want)
      : ((r as any).cuisine_type ?? "").toLowerCase().trim() === want);
    if (inPool) { setCataloguePicks(null); return; }

    let alive = true;
    setCatalogueLoading(true);
    void (isDishMood(mood) ? dishCandidates(here, want) : cuisineCandidates(here, String(mood)))
      .then((rows) => {
        if (alive) setCataloguePicks({ cuisine: String(mood), rows: (rows as unknown as RestaurantInput[]).filter((r) => !personal?.dislikes.placeIds.has(r.google_place_id) && !hiddenIds.has(r.google_place_id)) });
      })
      .catch(() => { if (alive) setCataloguePicks({ cuisine: String(mood), rows: [] }); })
      .finally(() => { if (alive) setCatalogueLoading(false); });
    return () => { alive = false; };
  }, [mood, here?.lat, here?.lng, allNearby]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ImpressionScrollView
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
            onChangeText={(t: string) => { setQuery(t); if (searchResults) setSearchResults(null); }}
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

        {/* Suggestions fill in as you type, from what we already know. They
            are replaced by the Google results once a search is submitted. */}
        {searchResults === null && query.trim().length >= 2 && (
          <View style={{ marginTop: spacing.lg }}>
            <View style={styles.searchHead}>
              <Text style={type.subtitle}>{suggestions.length > 0 ? "In your area" : "Looking…"}</Text>
              {suggestions.length > 0 && (
                <Pressable onPress={runSearch}>
                  <Text style={styles.clear}>Search everywhere</Text>
                </Pressable>
              )}
            </View>
            <Spacer size={10} />
            {suggestions.map((r) => (
              <RestaurantCompatibilityCard
                key={r.google_place_id}
                restaurant={r}
                surface="search"
                onDismissed={() => hideId(r.google_place_id)}
              />
            ))}
            {!suggesting && suggestions.length === 0 && (
              <Text style={[type.small, { lineHeight: 20 }]}>
                Nothing by that name nearby yet. Tap Search everywhere to look it up.
              </Text>
            )}
            {!suggesting && suggestions.length === 0 && (
              <>
                <Spacer size={10} />
                <Pressable onPress={runSearch}>
                  <Text style={styles.clear}>Search everywhere</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

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
              <Text style={[type.small, { lineHeight: 20 }]}>{searchFailed ? "Search didn't go through. Try again." : "No matches."}</Text>
            ) : (
              searchResults.map((r) => (
                <RestaurantCompatibilityCard
                  key={r.google_place_id}
                  restaurant={r}
                  surface="search"
                onDismissed={() => hideId(r.google_place_id)} />
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

            {/* Sub-tabs — order: Most Compatible → Stretch → Nearby */}
            <View style={styles.tabs}>
              <SubTabBtn label="Most Compatible" active={tab === "most_compatible"} onPress={() => setTab("most_compatible")} />
              <SubTabBtn label="Stretch"         active={tab === "stretch"}         onPress={() => setTab("stretch")} />
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
            <Spacer size={16} />

            {error && (
              <View style={styles.errCard}>
                <Text style={[type.body, { color: colors.mute }]}>{error}</Text>
              </View>
            )}

            {/* Skeletons only when there is nothing to show. Every return to
                this tab re-ran load(), which flipped hereLoading and swapped
                twelve mounted cards for skeletons, replaying entrances and
                losing scroll position on the browse → tap → back loop. */}
            {error ? null : (hereLoading || feedLoading) && allNearby.length === 0 ? (
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
                        Looking further out for {moodLabel(mood)}…
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
                    <List items={moodedList.items} onHide={hideId} surface="discover_for_you" requestId={requestIdRef.current} mood={mood} emptyMsg="Log a few visits. Once Palate sees a pattern, we'll personalize this list. In the meantime, the Trending tab shows what's hot in your area." />
                    <Spacer size={20} />
                    <Text style={styles.stretchHead}>Stretch your palate</Text>
                    <StretchPick />
                  </>
                )}
                {tab === "stretch" && (
                  stretchList.length > 0 ? (
                    <>
                      <Text style={styles.stretchNote}>
                        Outside what you usually pick, but close enough to something you
                        already like that it should land.
                      </Text>
                      <List items={stretchList} onHide={hideId} surface="discover_stretch" requestId={requestIdRef.current} slot="explore"
                        emptyMsg="Nothing here yet." />
                    </>
                  ) : (
                    <Text style={styles.emptyListText}>
                      Log a few more visits. Stretch needs to know your pattern before it can
                      step outside it.
                    </Text>
                  )
                )}
                {tab === "nearby" && (
                  <>
                    <MoodRow chips={moodChips} value={mood} onChange={setMood} />
                    {!!nearbyList.note && <Text style={styles.moodNote}>{nearbyList.note}</Text>}
                    <Spacer size={10} />
                    <List items={nearbyList.items} onHide={hideId} surface="discover_shelf" requestId={requestIdRef.current} mood={mood} emptyMsg="Nothing nearby." />
                  </>
                )}
              </>
            )}
          </>
        )}
      </ImpressionScrollView>

    </SafeAreaView>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

// Returns the occasion_tag values most relevant to the current time. Tags
// match the controlled vocabulary in classifier.ts.
function SubTabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

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
          No places indexed yet in this area. Start logging visits to fill the map.
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
function List({ items, surface, emptyMsg, onHide, requestId, slot, mood }: {
  items: RankedRestaurant[]; surface: any; emptyMsg: string; onHide?: (id: string) => void;
  requestId?: string; slot?: "exploit" | "explore"; mood?: string | null;
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
      {items.map((r, i) => (
        <RestaurantCompatibilityCard
          key={r.google_place_id}
          restaurant={r}
          surface={surface}
          rank={i}
          requestId={requestId}
          slot={slot}
          mood={mood}
          onDismissed={onHide ? () => onHide(r.google_place_id) : undefined}
        />
      ))}
    </View>
  );
}
function toInput(p: Restaurant): RestaurantInput {
  return {
    dish_family: (p as any).dish_family ?? null,
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

const styles = StyleSheet.create({
  moodNote: { ...type.small, marginTop: 10, lineHeight: 17 },
  stretchNote: {
    fontSize: 13, color: colors.mute, lineHeight: 19, marginBottom: 12,
  },
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
  tabTextActive: { color: colors.redText },

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
