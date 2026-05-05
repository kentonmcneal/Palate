import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from "react-native-maps";
import { colors, spacing, type } from "../theme";
import { nearbyRestaurants } from "../lib/places";
import { getEffectiveLocation, useBrowsingCity } from "../lib/browsing-location";
import { computeTasteVector, type TasteVector } from "../lib/taste-vector";
import { loadPersonalSignal } from "../lib/personal-signal";
import { assembleGraph, getCompatibility } from "../lib/recommendation";
import { MatchMarker, TopMatchMarker } from "../components/MatchMarker";
import { getCachedNearby, setCachedNearby } from "../lib/nearby-cache";
import { LocationPill } from "../components/LocationPill";

// Wider radius than the Discover-tab embedded map — fullscreen invites
// browsing further afield. The pan-to-refetch logic below also re-queries
// when the user drags to a new area.
const INITIAL_RADIUS_M = 4000;
const PAN_RADIUS_M = 2500;
const HIGH_MATCH_THRESHOLD = 75;

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
  const vectorRef = useRef<TasteVector | null>(null);
  const lastFetchCenter = useRef<{ lat: number; lng: number } | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<MapView | null>(null);

  const fetchAt = useCallback(async (lat: number, lng: number, radius: number, isInitial = false) => {
    if (isInitial) setLoading(true); else setRefetching(true);
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
    } catch {
      // silent — keep previous markers
    } finally {
      setLoading(false);
      setRefetching(false);
    }
  }, []);

  const initialLoad = useCallback(async () => {
    try {
      const loc = await getEffectiveLocation();
      if (!loc) { setLoading(false); return; }
      setHere({ lat: loc.lat, lng: loc.lng });
      await fetchAt(loc.lat, loc.lng, INITIAL_RADIUS_M, true);
    } catch {
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

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <LocationPill />
        <View style={{ width: 40 }} />
      </View>
      {loading || !here ? (
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
            onRegionChangeComplete={handleRegionChangeComplete}
          >
            {placesArr.map((p) => {
              const isTop = p.matchScore != null && p.matchScore === topScore && topScore >= HIGH_MATCH_THRESHOLD;
              return (
                <Marker
                  key={p.google_place_id}
                  coordinate={{ latitude: p.latitude, longitude: p.longitude }}
                  title={p.name}
                  description={p.matchScore ? `${p.matchScore}% match` : undefined}
                  anchor={{ x: 0.5, y: 0.5 }}
                  onPress={() => router.push(`/restaurant/${p.google_place_id}` as any)}
                >
                  {isTop ? <TopMatchMarker score={p.matchScore!} /> : <MatchMarker score={p.matchScore} />}
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
});
