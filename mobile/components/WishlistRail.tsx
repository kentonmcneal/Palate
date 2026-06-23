// Horizontal rail of saved restaurants near the user. Used on Home and (when
// the user lands in a city with saved places) shows the most relevant subset.
//
// Filtering / data loading lives in the parent screen; this component is
// purely presentational so it can drop into any layout.

import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, spacing, type, radius } from "../theme";
import { distanceKm } from "../lib/match-score";
import type { WishlistEntry } from "../lib/palate-insights";

export function WishlistRail({
  items, here, onTap,
}: {
  items: WishlistEntry[];
  here: { lat: number; lng: number } | null;
  onTap: (googlePlaceId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[type.micro, { marginBottom: 10 }]}>
        FROM YOUR WISHLIST{here ? " · NEAR HERE" : ""}
      </Text>
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
              style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
              {meta.length > 0 && (
                <Text style={styles.sub} numberOfLines={1}>{meta}</Text>
              )}
              <View style={styles.footRow}>
                {r.price_level != null && r.price_level > 0 && (
                  <Text style={styles.meta}>{"$".repeat(r.price_level)}</Text>
                )}
                {km != null && (
                  <Text style={styles.meta}>
                    {km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: colors.faint,
    borderRadius: 14,
    minWidth: 160, maxWidth: 220,
    borderWidth: 1, borderColor: colors.line,
  },
  name: {
    fontSize: 14, fontWeight: "700", color: colors.ink,
    letterSpacing: -0.2,
  },
  sub: { fontSize: 12, color: colors.mute, marginTop: 2 },
  footRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  meta: { fontSize: 11, color: colors.ink, fontWeight: "700" },
});
