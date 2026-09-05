import { useCallback, useEffect, useRef, useState } from "react";
import { View, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from "react-native-maps";
import { colors, spacing, type } from "../theme";
import { nearbyRestaurants } from "../lib/places";
import { getEffectiveLocation, useBrowsingCity } from "../lib/browsing-location";
import { computeTasteVector, type TasteVector } from "../lib/taste-vector";
import { loadPersonalSignal } from "../lib/personal-signal";
import { assembleGraph, getCompatibility } from "../lib/recommendation";
import { isRecommendable } from "../lib/recommendation/eligibility";
import { MatchMarker, TopMatchMarker, DotMarker } from "../components/MatchMarker";
import { LoadError } from "../components/LoadError";
import { formatDistance } from "../lib/match-score";
import { getCachedNearby, setCachedNearby } from "../lib/nearby-cache";
import { LocationPill } from "../components/LocationPill";

// Wider radius than the Discover-tab embedded map — fullscreen invites
// browsing further afield. The pan-to-refetch logic below also re-queries
// when the user drags to a new area.
const INITIAL_RADIUS_M = 4000;
const PAN_RADIUS_M = 2500;
const HIGH_MATCH_THRESHOLD = 75;
// Only this many places get a numbered pin. Everything else is a dot. At
// 4km the map held sixty pulsing badges and read as a wall; twelve is the
// most anyone reads before they start scanning colour instead.
const NUMBERED_PINS = 12;

// Distance threshold (km) — when the map center moves more than this from
// the last query center, refetch nearby for the new area. Quantized so a
// single tiny pan doesn't trigger a refetch.
const REFETCH_THRESHOLD_KM = 0.6;

type MapPlace = {
  google_place_id: string;
  name: string;
  latitude: number;
  longitude: number;
  matchScore: number | null;
};

export default function FullscreenMap() {
  const router = useRouter();
  const [browsingCity] = useBrowsingCity();
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [places, setPlaces] = useState<Map<string, MapPlace>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [initialError, setInitialError] = useState<unknown>(null);
  // Tapping a marker selects it and shows a card at the bottom; a second tap
  // or the card's Open button navigates. The native callout bubble is gone:
  // it hid the number and offered nothing to do.
  const [selected, setSelected] = useState<MapPlace | null>(null);
  const vectorRef = useRef<TasteVector | null>(null);
  const lastFetchCenter = useRef<{ lat: number; lng: number } | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<MapView | null>(null);

  const fetchAt = useCallback(async (lat: number, lng: number, radius: number, isInitial = false) => {
    if (isInitial) setLoading(true); else setRefetching(true);
    setFetchError(null);
    try {
      // Try cache first
      let nearby = await getCachedNearby(lat, lng, radius);
      if (!nearby) {
        nearby = await nearbyRestaurants(lat, lng, radius);
        void setCachedNearby(lat, lng, radius, nearby);
      }
      lastFetchCenter.current = { lat, lng };

      // Build the canonical taste graph once per fetch and reuse for every
      // marker. The compatibility cache (in lib/recommendation) ensures each
      // (user, restaurant) is scored exactly once across all surfaces.
      const vector = vectorRef.current ?? await computeTasteVector().catch(() => null);
      vectorRef.current = vector;
      const personal = await loadPersonalSignal().catch(() => null);
      const graph = assembleGraph(vector, personal);

      setPlaces((prev) => {
        const next = new Map(prev);
        for (const p of nearby!) {
          if (p.latitude == null || p.longitude == null) continue;
          if (next.has(p.google_place_id)) continue;
          // Skip ineligible places on the discovery map (chains, fast food,
          // airports, hotels). One shared gate — see recommendation/eligibility.
          // Visit-logging surfaces deliberately do NOT apply this filter.
          if (!isRecommendable(p, { hidden: personal?.dislikes.placeIds ?? null })) continue;
          const compat = getCompatibility(graph, {
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
            latitude: p.latitude,
            longitude: p.longitude,
          });
          next.set(p.google_place_id, {
            google_place_id: p.google_place_id,
            name: p.name,
            latitude: p.latitude!,
            longitude: p.longitude!,
            matchScore: compat.score,
          });
        }
        return next;
      });
    } catch (e: any) {
      // Keep previous markers, but tell the user why nothing new loaded
      // instead of failing silently (the old behavior looked like a freeze).
      const msg = String(e?.message ?? e ?? "");
      setFetchError(
        msg.includes("rate_limited")
          ? "Slow down a sec. Too many map moves, so new spots will load shortly."
          : "Couldn't load this area. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
      setRefetching(false);
    }
  }, []);

  const initialLoad = useCallback(async () => {
    try {
      setInitialError(null);
      const loc = await getEffectiveLocation();
      if (!loc) { setLoading(false); return; }
      setHere({ lat: loc.lat, lng: loc.lng });
      await fetchAt(loc.lat, loc.lng, INITIAL_RADIUS_M, true);
    } catch (e) {
      setInitialError(e ?? new Error("map load failed"));
      setLoading(false);
    }
  }, [fetchAt]);

  useEffect(() => { initialLoad(); }, [initialLoad]);

  // When the user picks a different city, animate to it and clear stale
  // markers so the new area's results aren't crowded out by the old ones.
  useEffect(() => {
    if (!browsingCity) return;
    setPlaces(new Map());
    lastFetchCenter.current = null;
    setHere({ lat: browsingCity.lat, lng: browsingCity.lng });
    if (mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: browsingCity.lat,
        longitude: browsingCity.lng,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }, 600);
    }
    void fetchAt(browsingCity.lat, browsingCity.lng, INITIAL_RADIUS_M, false);
  }, [browsingCity?.id]);

  // Pan handler — debounced. When the user drags to a new neighborhood we
  // refetch for that area. Existing markers stay in place via the Map merge.
  function handleRegionChangeComplete(region: Region) {
    const last = lastFetchCenter.current;
    if (!last) return;
    const km = haversineKm(last, { lat: region.latitude, lng: region.longitude });
    if (km < REFETCH_THRESHOLD_KM) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void fetchAt(region.latitude, region.longitude, PAN_RADIUS_M, false);
    }, 700);
  }

  const placesArr = [...places.values()];
  const topScore = placesArr.reduce((m, p) => Math.max(m, p.matchScore ?? 0), 0);
  // Hierarchy: the best dozen carry a number, the rest are dots. The eye finds
  // the warm cluster first and reads numbers only where they are worth it.
  const numbered = new Set(
    [...placesArr]
      .filter((p) => p.matchScore != null)
      .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
      .slice(0, NUMBERED_PINS)
      .map((p) => p.google_place_id),
  );
  const selectedKm = selected && here
    ? haversineKm(here, { lat: selected.latitude, lng: selected.longitude })
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <LocationPill />
        <View style={{ width: 40 }} />
      </View>
      {initialError ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <LoadError error={initialError} onRetry={() => { setLoading(true); void initialLoad(); }} />
        </View>
      ) : loading || !here ? (
        <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
      ) : (
        <View style={{ flex: 1 }}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_DEFAULT}
            style={{ flex: 1 }}
            initialRegion={{
              latitude: here.lat,
              longitude: here.lng,
              latitudeDelta: 0.03,
              longitudeDelta: 0.03,
            }}
            showsUserLocation
            showsMyLocationButton
            // Apple's own POI labels were competing with ours for every
            // restaurant on screen. Off, along with traffic, so the only
            // things named on this map are the ones we put there.
            showsPointsOfInterests={false}
            showsTraffic={false}
            showsBuildings
            showsCompass={false}
            mapPadding={{ top: 8, right: 8, bottom: selected ? 150 : 8, left: 8 }}
            onPress={() => setSelected(null)}
            onRegionChangeComplete={handleRegionChangeComplete}
          >
            {placesArr.map((p) => {
              const isTop = p.matchScore != null && p.matchScore === topScore && topScore >= HIGH_MATCH_THRESHOLD;
              return (
                <Marker
                  key={p.google_place_id}
                  coordinate={{ latitude: p.latitude, longitude: p.longitude }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  zIndex={isTop ? 3 : numbered.has(p.google_place_id) ? 2 : 1}
                  tracksViewChanges={numbered.has(p.google_place_id)}
                  onPress={(e) => { e.stopPropagation(); setSelected(p); }}
                >
                  {isTop
                    ? <TopMatchMarker score={p.matchScore!} />
                    : numbered.has(p.google_place_id)
                      ? <MatchMarker score={p.matchScore} />
                      : <DotMarker score={p.matchScore} />}
                </Marker>
              );
            })}
          </MapView>
          {refetching && (
            <View style={styles.refetchPill}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.refetchText}>Loading area…</Text>
            </View>
          )}
          {selected && (
            <View style={styles.sheet}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetName} numberOfLines={1}>{selected.name}</Text>
                <Text style={styles.sheetMeta}>
                  {[
                    selected.matchScore != null ? `${selected.matchScore}% match` : null,
                    selectedKm != null ? formatDistance(selectedKm) : null,
                  ].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <Pressable
                onPress={() => router.push(`/restaurant/${selected.google_place_id}` as any)}
                style={styles.sheetBtn}
                accessibilityRole="button"
              >
                <Text style={styles.sheetBtnText}>Open</Text>
              </Pressable>
            </View>
          )}
          {!refetching && fetchError && (
            <Pressable style={styles.errorPill} onPress={() => { if (here) void fetchAt(here.lat, here.lng, PAN_RADIUS_M, false); }}>
              <Text style={styles.errorText}>{fetchError}  ·  Tap to retry</Text>
            </Pressable>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  refetchPill: {
    position: "absolute",
    top: 12, alignSelf: "center",
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(17,17,17,0.9)",
  },
  refetchText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  errorPill: {
    position: "absolute",
    top: 12, alignSelf: "center",
    maxWidth: "92%",
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(200,30,20,0.95)",
  },
  errorText: { color: "#fff", fontSize: 12, fontWeight: "700", textAlign: "center" },
  sheet: {
    position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.lg,
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 16, borderRadius: 18, backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.line,
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  sheetName: { fontSize: 16, fontWeight: "700", color: colors.ink },
  sheetMeta: { ...type.small, marginTop: 3 },
  sheetBtn: { paddingHorizontal: 16, height: 36, borderRadius: 18, backgroundColor: colors.red, alignItems: "center", justifyContent: "center" },
  sheetBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
});
