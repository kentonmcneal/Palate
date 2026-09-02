import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { colors } from "../theme";
import { useBrowsingCity } from "../lib/browsing-location";

// ============================================================================
// LocationPill — small chip showing the user's current "browse" location.
// Tap → opens the city picker. Shows "Your location" when no override.
// Used on Home and Discover so trip planning is one tap away.
//
// The dot is a live status light, not decoration:
//   green + pulse — real GPS, permission granted ("we know where you are")
//   grey          — location permission is off, so "Your location" is a
//                   promise we can't keep; tapping opens the picker
//   red on ink    — a manually picked city is overriding GPS
// A tester asked for the green dot specifically; the honest version also
// needed the off state, otherwise the pill claims a fix it doesn't have.
// ============================================================================

export function LocationPill() {
  const router = useRouter();
  const [city] = useBrowsingCity();
  const [gpsGranted, setGpsGranted] = useState<boolean | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;

  // Permission status only — deliberately NOT getCurrentPositionAsync, which
  // would spin up the GPS on every mount just to color a dot.
  useEffect(() => {
    let alive = true;
    Location.getForegroundPermissionsAsync()
      .then((p) => alive && setGpsGranted(p.status === "granted"))
      .catch(() => alive && setGpsGranted(false));
    return () => { alive = false; };
  }, [city?.id]);

  const live = !city && gpsGranted === true;

  useEffect(() => {
    if (!live) { pulse.stopAnimation(); pulse.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [live, pulse]);

  const label = city ? city.name : "Your location";

  return (
    <Pressable
      onPress={() => router.push("/location-picker")}
      style={[styles.pill, city && styles.pillActive]}
      accessibilityRole="button"
      accessibilityLabel={
        city
          ? `Browsing ${label}. Tap to change.`
          : live
            ? "Browsing your current location. Tap to change."
            : "Location is off. Tap to pick a city."
      }
    >
      <View style={styles.dotWrap}>
        {live && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.halo,
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
              },
            ]}
          />
        )}
        <View
          style={[
            styles.dot,
            city ? styles.dotOverride : live ? styles.dotLive : styles.dotIdle,
          ]}
        />
      </View>
      <Text style={[styles.text, city && styles.textActive]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.chev, city && styles.textActive]}>⌄</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
    alignSelf: "flex-start",
  },
  pillActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  dotWrap: { width: 8, height: 8, alignItems: "center", justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  halo: { position: "absolute", width: 8, height: 8, borderRadius: 4, backgroundColor: colors.live },
  dotIdle: { backgroundColor: colors.mute },
  dotLive: { backgroundColor: colors.live },
  dotOverride: { backgroundColor: colors.red },
  text: { fontSize: 13, fontWeight: "700", color: colors.ink, maxWidth: 180 },
  textActive: { color: "#fff" },
  chev: { fontSize: 12, color: colors.mute, fontWeight: "800" },
});
