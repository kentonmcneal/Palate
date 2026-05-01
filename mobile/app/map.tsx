import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { colors, spacing, type } from "../theme";
import { nearbyRestaurants } from "../lib/places";
import { getCurrentLocation } from "../lib/location";
import { computeTasteVector } from "../lib/taste-vector";
import { scoreMatch } from "../lib/match-score";
import { MatchMarker, TopMatchMarker } from "../components/MatchMarker";

const MAP_RADIUS_M = 3000;
const HIGH_MATCH_THRESHOLD = 75;

type MapPlace = {
  google_place_id: string;
  name: string;
  latitude: number;
  longitude: number;
  matchScore: number | null;
};

export default function FullscreenMap() {
  const router = useRouter();
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [places, setPlaces] = useState<MapPlace[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const loc = await getCurrentLocation();
      setHere({ lat: loc.lat, lng: loc.lng });
      const [nearby, vector] = await Promise.all([
        nearbyRestaurants(loc.lat, loc.lng, MAP_RADIUS_M),
        computeTasteVector().catch(() => null),
      ]);
      setPlaces(
        nearby
          .filter((p) => p.latitude != null && p.longitude != null)
          .map((p) => {
            const ctx = {
              cuisineRegion: (p as any).cuisine_region ?? null,
              cuisineSubregion: (p as any).cuisine_subregion ?? null,
              formatClass: (p as any).format_class ?? null,
              occasionTags: (p as any).occasion_tags ?? null,
              flavorTags: (p as any).flavor_tags ?? null,
            };
            const m = vector ? scoreMatch(vector, {
              cuisine: p.cuisine_type ?? null,
              price_level: p.price_level ?? null,
              neighborhood: p.neighborhood ?? null,
            }, ctx) : null;
            return {
              google_place_id: p.google_place_id,
              name: p.name,
              latitude: p.latitude!,
              longitude: p.longitude!,
              matchScore: m?.score ?? null,
            };
          }),
      );
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const topScore = places.reduce((m, p) => Math.max(m, p.matchScore ?? 0), 0);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Map</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading || !here ? (
        <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
      ) : (
        <MapView
          provider={PROVIDER_DEFAULT}
          style={{ flex: 1 }}
          initialRegion={{
            latitude: here.lat,
            longitude: here.lng,
            latitudeDelta: 0.025,
            longitudeDelta: 0.025,
          }}
          showsUserLocation
          showsMyLocationButton
        >
          {places.map((p) => {
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
      )}
    </SafeAreaView>
  );
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
});
