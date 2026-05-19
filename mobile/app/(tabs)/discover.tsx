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
import { supabase } from "../../lib/supabase";
import { listWishlist, type WishlistEntry } from "../../lib/palate-insights";
import { loadRecsFromSaves, type SaveAnchoredRec } from "../../lib/recs-from-saves";
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
  const [wishlistRail, setWishlistRail] = useState<WishlistEntry[]>([]);
  const [hasAnySaves, setHasAnySaves] = useState<boolean | null>(null);
  const [savesAnchors, setSavesAnchors] = useState<Array<{ id: string; name: string }>>([]);
  const [savesRecs, setSavesRecs] = useState<SaveAnchoredRec[]>([]);

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
      const [nearby, vec, sig, visitedIds, wish] = await Promise.all([
        nearbyRestaurants(loc.lat, loc.lng, NEARBY_RADIUS_M),
        computeTasteVector().catch(() => null),
        loadPersonalSignal().catch(() => null),
        user ? loadVisitedPlaceIds(user.id) : Promise.resolve(new Set<string>()),
        listWishlist().catch(() => []),
      ]);

      // Hybrid discovery policy:
      //   - Drop places with recommendation_eligibility === 0 (chains, airports,
      //     hotels, lounges — see classifier inferRecommendationEligibility)
      //   - Drop places the user has already visited (wishlist rail surfaces
      //     intentional saves separately so they don't get hidden)
      const candidates = nearby.filter(
        (p) => (p.recommendation_eligibility ?? 1) > 0 && !visitedIds.has(p.google_place_id),
      );

      setVector(vec);
      setPersonal(sig);
      setAllNearby(candidates.map(toInput));
      setWishlistRail(filterWishlistForHere(wish, { lat: loc.lat, lng: loc.lng }));
      setHasAnySaves(wish.length > 0);
      setFeedLoading(false);

      // Saves-anchored recs run after the main feed renders so the screen
      // isn't blocked. Errors are swallowed — the rail is best-effort.
      void loadRecsFromSaves()
        .then((res) => { setSavesAnchors(res.anchors); setSavesRecs(res.recs); })
        .catch(() => { setSavesAnchors([]); setSavesRecs([]); });

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

  // Trending: grouped into Beli-style category shelves ("Top 10 Burgers"…),
  // plus a fallback shelf when category coverage is sparse.
  const trending = useMemo(
    () => buildTrendingGroups(allRanked, vector),
    [allRanked, vector],
  );

  // Most Compatible — sort by canonical compatibilityScore (per spec, NOT
  // finalScore), with a small time-of-day boost so brunch spots rise on
  // weekend mornings, late_night bars at 11pm, etc. Boost is applied to the
  // sort key only, not the displayed score, to avoid inflating "% match".
  const mostCompatibleList = useMemo(() => {
    const now = new Date();
    const occs = currentOccasions(now);
    const keyFor = (r: RankedRestaurant) =>
      r.score.compatibilityScore + timeOfDayBoost(r.occasion_tags ?? null, occs);

    const arr = allRanked.map((r) => ({ item: r, sortKey: keyFor(r) }));
    if (sort === "compat_high") {
      arr.sort((a, b) => b.sortKey - a.sortKey);
    } else if (sort === "compat_low") {
      arr.sort((a, b) => a.sortKey - b.sortKey);
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
    return arr.map((x) => x.item).slice(0, TOP_PER_TAB);
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
            {/* Wishlist rail — saved places near here. Kept above featured /
                sub-tabs because saved-intent should be one tap away. */}
            {wishlistRail.length > 0 && (
              <WishlistRail
                items={wishlistRail}
                here={here}
                onTap={(gpid) => router.push(`/restaurant/${gpid}` as any)}
              />
            )}

            {/* Based on your saves — uses wishlist as the rec anchor so the
                feed isn't dominated by whatever the user happens to eat. When
                the user has no saves yet, surface a nudge explaining the
                feature so it doesn't feel like dead UI. */}
            {savesRecs.length > 0 ? (
              <BasedOnSaves
                anchors={savesAnchors}
                recs={savesRecs}
                onTap={(gpid) => router.push(`/restaurant/${gpid}` as any)}
              />
            ) : hasAnySaves === false ? (
              <View style={styles.savesEmpty}>
                <Text style={[type.micro, { marginBottom: 4 }]}>BASED ON YOUR SAVES</Text>
                <Text style={[type.small, { lineHeight: 18 }]}>
                  Save a few restaurants and we'll find more like them. Tap the heart on any place to start.
                </Text>
              </View>
            ) : null}

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
                    <List items={mostCompatibleList} surface="discover_for_you" emptyMsg="Log a few visits — once Palate sees a pattern, we'll personalize this list. In the meantime, the Trending tab shows what's hot in your area." />
                  </>
                )}
                {tab === "trending" && <TrendingGroups groups={trending.groups} fallbackNote={trending.fallbackNote} />}
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

function BasedOnSaves({
  anchors, recs, onTap,
}: {
  anchors: Array<{ id: string; name: string }>;
  recs: SaveAnchoredRec[];
  onTap: (googlePlaceId: string) => void;
}) {
  const namesLine = anchors.slice(0, 3).map((a) => a.name).join(", ")
    + (anchors.length > 3 ? ` +${anchors.length - 3}` : "");
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[type.micro, { marginBottom: 4 }]}>BASED ON YOUR SAVES</Text>
      <Text style={[type.small, { marginBottom: 10, lineHeight: 18 }]} numberOfLines={2}>
        Because you saved <Text style={{ color: colors.ink, fontWeight: "600" }}>{namesLine}</Text>
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingRight: spacing.md }}
      >
        {recs.map((r) => (
          <Pressable
            key={r.id}
            onPress={() => onTap(r.google_place_id)}
            style={({ pressed }) => [styles.savesCard, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.savesCardName} numberOfLines={1}>{r.name}</Text>
            <Text style={styles.savesCardSub} numberOfLines={1}>
              {[
                r.cuisine_type ? r.cuisine_type[0].toUpperCase() + r.cuisine_type.slice(1) : null,
                r.neighborhood,
                r.price_level != null && r.price_level > 0 ? "$".repeat(r.price_level) : null,
              ].filter(Boolean).join(" · ")}
            </Text>
            <Text style={styles.savesCardWhy} numberOfLines={1}>
              Like {r.matchedAgainst.slice(0, 2).join(" + ")}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function WishlistRail({
  items, here, onTap,
}: {
  items: WishlistEntry[];
  here: { lat: number; lng: number } | null;
  onTap: (googlePlaceId: string) => void;
}) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[type.micro, { marginBottom: 10 }]}>FROM YOUR WISHLIST · NEAR HERE</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingRight: spacing.md }}
      >
        {items.map((w) => {
          const r = w.restaurant;
          if (!r) return null;
          const km =
            here && r.latitude != null && r.longitude != null
              ? distanceKm(here, { lat: r.latitude, lng: r.longitude })
              : null;
          const meta = [
            r.cuisine_type ? r.cuisine_type[0].toUpperCase() + r.cuisine_type.slice(1) : null,
            r.neighborhood,
          ].filter(Boolean).join(" · ");
          return (
            <Pressable
              key={w.id}
              onPress={() => onTap(r.google_place_id)}
              style={({ pressed }) => [styles.wishChip, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.wishChipName} numberOfLines={1}>{r.name}</Text>
              {meta.length > 0 && (
                <Text style={styles.wishChipSub} numberOfLines={1}>{meta}</Text>
              )}
              <View style={styles.wishChipFootRow}>
                {r.price_level != null && r.price_level > 0 && (
                  <Text style={styles.wishChipMeta}>{"$".repeat(r.price_level)}</Text>
                )}
                {km != null && (
                  <Text style={styles.wishChipMeta}>{km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}</Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// Pick up to 8 wishlist entries within ~15km of the current location. If the
// user has no coordinates on a saved place (older row), include it anyway.
function filterWishlistForHere(
  wish: WishlistEntry[],
  here: { lat: number; lng: number },
): WishlistEntry[] {
  return wish
    .filter((w) => {
      const r = w.restaurant;
      if (!r) return false;
      if (r.latitude == null || r.longitude == null) return true;
      const km = distanceKm(here, { lat: r.latitude, lng: r.longitude });
      return km < 15;
    })
    .slice(0, 8);
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
    fallbackNote: "Strong picks nearby — category shelves unlock as more people log in your area.",
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

  emptyList: {
    padding: spacing.lg,
    borderRadius: 16,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  emptyListText: { ...type.small, lineHeight: 20 },
  wishChip: {
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: colors.faint,
    borderRadius: 14,
    minWidth: 160, maxWidth: 220,
    borderWidth: 1, borderColor: colors.line,
  },
  wishChipName: {
    fontSize: 14, fontWeight: "700", color: colors.ink,
    letterSpacing: -0.2,
  },
  wishChipSub: {
    fontSize: 12, color: colors.mute, marginTop: 2,
  },
  wishChipFootRow: {
    flexDirection: "row", gap: 8, marginTop: 6,
  },
  wishChipMeta: {
    fontSize: 11, color: colors.ink, fontWeight: "700",
  },
  savesCard: {
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: colors.ink,
    borderRadius: 14,
    minWidth: 180, maxWidth: 240,
  },
  savesCardName: { fontSize: 15, fontWeight: "700", color: "#fff", letterSpacing: -0.2 },
  savesCardSub: { fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 3 },
  savesCardWhy: { fontSize: 11, color: colors.red, marginTop: 6, fontWeight: "700" },
  savesEmpty: {
    backgroundColor: colors.faint,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
});
