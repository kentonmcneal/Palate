import { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Pressable, Animated, Easing } from "react-native";
import { Text } from "./Text";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { useRouter } from "expo-router";
import { colors, spacing, type, card, shadow } from "../theme";
import { getEffectiveLocation } from "../lib/browsing-location";
import { placeHeat, heatHeadline, crowdSize, type HotPlace } from "../lib/place-heat";

// ============================================================================
// HypeMap — the crowd view on the Feed.
// ----------------------------------------------------------------------------
// The founder's picture: a map like Snapchat's or Find My, little people
// crowding the places with traffic, the hottest lighting up. This is the
// version that ships without a native build, on react-native-maps and the
// Animated API already in the bundle:
//
//   * pitched camera with buildings on, which is the 2.5D Apple Maps gives
//     away for free
//   * each hot place is a soft glow whose size and warmth scale with heat,
//     breathing on a loop; the top place gets a flame
//   * the "people" are small dots clustered at the place, one per recent
//     visit or save, capped at five
//   * tapping a place opens it
//
// The full isometric version with walking figures needs Skia — a native
// module, a new binary. docs/HYPE_MAP.md has that plan. This one is real now.
//
// Honesty rule: heat is normalised within the set, so the top marker is
// always 100. The headline says which regime the data is in so "Popular near
// you" never reads as "trending".
// ============================================================================

const HEIGHT = 240;

export function HypeMap() {
  const router = useRouter();
  const [places, setPlaces] = useState<HotPlace[] | null>(null);
  const [failed, setFailed] = useState(false);
  const mapRef = useRef<MapView | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const here = await getEffectiveLocation();
        if (!here) { if (alive) setPlaces([]); return; }
        const hot = await placeHeat({ lat: here.lat, lng: here.lng });
        if (alive) setPlaces(hot);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Fit the hot set once it lands, with room for the chrome. Pitch after the
  // fit: fitToCoordinates resets the camera, so the tilt goes on last.
  useEffect(() => {
    if (!places || places.length === 0 || !mapRef.current) return;
    const map = mapRef.current;
    map.fitToCoordinates(
      places.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
      { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false },
    );
    const t = setTimeout(() => {
      map.getCamera().then((cam) => {
        map.animateCamera({ ...cam, pitch: 45 }, { duration: 600 });
      }).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [places]);

  const headline = useMemo(() => (places ? heatHeadline(places) : null), [places]);

  // A failed load or an empty city is not worth a card. The Feed is about
  // people; this is a garnish, and a garnish that says "couldn't load" is
  // noise.
  if (failed || (places && places.length === 0)) return null;
  if (!places) return <View style={[styles.card, { height: HEIGHT + 64 }]} />;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{headline?.title}</Text>
          <Text style={styles.sub}>{headline?.sub}</Text>
        </View>
        <Pressable onPress={() => router.push("/map" as never)} hitSlop={8}>
          <Text style={styles.link}>Open map</Text>
        </Pressable>
      </View>
      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={StyleSheet.absoluteFill}
          initialRegion={{
            latitude: places[0].latitude,
            longitude: places[0].longitude,
            latitudeDelta: 0.04,
            longitudeDelta: 0.04,
          }}
          showsBuildings
          showsPointsOfInterests={false}
          showsTraffic={false}
          showsCompass={false}
          pitchEnabled
          rotateEnabled={false}
          scrollEnabled={false}
          zoomEnabled={false}
          toolbarEnabled={false}
        >
          {places.map((p, i) => (
            <Marker
              key={p.google_place_id}
              coordinate={{ latitude: p.latitude, longitude: p.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              // The glow is animated, so the marker view must keep rendering.
              tracksViewChanges
              onPress={() => router.push(`/restaurant/${p.google_place_id}` as never)}
            >
              <HeatMarker heat={p.heat} crowd={crowdSize(p)} top={i === 0 && p.regime !== "baseline"} />
            </Marker>
          ))}
        </MapView>
      </View>
      <View style={styles.legend}>
        {places.slice(0, 3).map((p, i) => (
          <Pressable
            key={p.google_place_id}
            onPress={() => router.push(`/restaurant/${p.google_place_id}` as never)}
            style={styles.legendRow}
          >
            <Text style={styles.legendRank}>{i + 1}</Text>
            <Text style={styles.legendName} numberOfLines={1}>{p.name}</Text>
            <Text style={styles.legendMeta}>
              {p.regime === "palate"
                ? `${p.palate_visits_30d + p.saves} on Palate`
                : p.rating != null ? `${p.rating} · ${compact(p.user_rating_count ?? 0)}` : ""}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
}

// The glow, the crowd, and for the top place a flame.
function HeatMarker({ heat, crowd, top }: { heat: number; crowd: number; top: boolean }) {
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 1, duration: 1400 - heat * 6, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(breath, { toValue: 0, duration: 1400 - heat * 6, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [breath, heat]);

  const size = 14 + Math.round((heat / 100) * 26); // 14..40
  const warm = heat >= 66 ? colors.red : heat >= 33 ? "#E8873A" : colors.mute;
  const scale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const fade = breath.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.05] });

  return (
    <View style={{ width: size + 36, height: size + 36, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{
        position: "absolute", width: size + 16, height: size + 16, borderRadius: (size + 16) / 2,
        backgroundColor: warm, opacity: fade, transform: [{ scale }],
      }} />
      <View style={{
        width: size, height: size, borderRadius: size / 2, backgroundColor: warm,
        borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center",
      }}>
        {top && <Text style={{ fontSize: Math.max(10, size * 0.5) }}>🔥</Text>}
      </View>
      {Array.from({ length: crowd }).map((_, i) => {
        const angle = (i / Math.max(1, crowd)) * Math.PI * 2 + 0.6;
        const r = size / 2 + 9;
        return (
          <View key={i} style={{
            position: "absolute",
            left: (size + 36) / 2 + Math.cos(angle) * r - 4,
            top: (size + 36) / 2 + Math.sin(angle) * r - 4,
            width: 8, height: 8, borderRadius: 4,
            backgroundColor: colors.ink, borderWidth: 1.5, borderColor: "#fff",
          }} />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg, marginBottom: spacing.lg,
    borderRadius: card.radius, backgroundColor: colors.faint, overflow: "hidden",
    ...shadow.card,
  },
  head: { flexDirection: "row", alignItems: "center", padding: card.padding, paddingBottom: 10, gap: 10 },
  title: { ...type.subtitle, color: colors.ink },
  sub: { ...type.small, marginTop: 2 },
  link: { fontSize: 13, fontWeight: "700", color: colors.red },
  mapWrap: { height: HEIGHT, backgroundColor: colors.line },
  legend: { paddingHorizontal: card.padding, paddingVertical: 8 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  legendRank: { width: 16, fontSize: 12, fontWeight: "800", color: colors.mute },
  legendName: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.ink },
  legendMeta: { fontSize: 12, color: colors.mute },
});
