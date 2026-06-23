// "Because you saved X, Y, Z" rail.
// Presentational only — parent owns the data loading via loadRecsFromSaves().

import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, spacing, type } from "../theme";
import type { SaveAnchoredRec } from "../lib/recs-from-saves";

export function BasedOnSaves({
  anchors, recs, onTap,
}: {
  anchors: Array<{ id: string; name: string }>;
  recs: SaveAnchoredRec[];
  onTap: (googlePlaceId: string) => void;
}) {
  if (recs.length === 0) return null;
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
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {[
                r.cuisine_type ? r.cuisine_type[0].toUpperCase() + r.cuisine_type.slice(1) : null,
                r.neighborhood,
                r.price_level != null && r.price_level > 0 ? "$".repeat(r.price_level) : null,
              ].filter(Boolean).join(" · ")}
            </Text>
            <Text style={styles.why} numberOfLines={1}>
              Like {r.matchedAgainst.slice(0, 2).join(" + ")}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// Empty-state nudge — shown by parent when the user has no saves at all.
export function BasedOnSavesEmpty() {
  return (
    <View style={styles.empty}>
      <Text style={[type.micro, { marginBottom: 4 }]}>BASED ON YOUR SAVES</Text>
      <Text style={[type.small, { lineHeight: 18 }]}>
        Save a few restaurants and we'll find more like them. Tap the heart on any place to start.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: colors.ink,
    borderRadius: 14,
    minWidth: 180, maxWidth: 240,
  },
  name: { fontSize: 15, fontWeight: "700", color: "#fff", letterSpacing: -0.2 },
  sub: { fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 3 },
  why: { fontSize: 11, color: colors.red, marginTop: 6, fontWeight: "700" },
  empty: {
    backgroundColor: colors.faint,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
});
