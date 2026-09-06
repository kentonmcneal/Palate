import { ScrollView, StyleSheet, Pressable, View } from "react-native";
import { Text } from "./Text";
import { colors, categoryColors, spacing } from "../theme";
import { triggerHapticSelection } from "../lib/haptics";
import { QUICK, SIT_DOWN, SOMEWHERE_NEW, dishOf, isDishMood } from "../lib/mood";
import type { Mood, MoodChip } from "../lib/mood";
import { FONT_CAP } from "../lib/a11y";
import { cuisineHue } from "./PlaceArt";

/** Each chip carries the hue its places are painted in, so choosing Thai
 *  turns the row the same green the Thai rows below it wear. Anything stays
 *  ink: it is the absence of a choice, not one more colour. */
export function chipHue(key: Mood): string {
  if (key == null) return colors.ink;
  if (key === SOMEWHERE_NEW) return categoryColors.pine;
  if (key === QUICK || key === SIT_DOWN) return categoryColors.olive;
  if (isDishMood(key)) return cuisineHue(dishOf(key), String(key));
  return cuisineHue(key, key);
}

// ============================================================================
// MoodRow — "what do you actually want tonight?"
// ----------------------------------------------------------------------------
// Sits directly above the recommendations it modifies, so the cause and the
// effect are on screen together. Chips are the user's OWN top cuisines, which
// keeps the row short and personal rather than presenting a cuisine menu.
// ============================================================================

export function MoodRow({
  chips,
  value,
  onChange,
  note,
}: {
  chips: MoodChip[];
  value: Mood;
  onChange: (m: Mood) => void;
  note?: string | null;
}) {
  // Was "hide below three chips", from when a new account had only Anything +
  // Surprise and there was genuinely nothing to offer. Quick / Sit down /
  // Somewhere new need no history at all, and a brand-new user is exactly who
  // needs help deciding, so the row now earns its place from day one.
  if (chips.length <= 1) return null;

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {chips.map((c) => {
          const active = c.key === value;
          const hue = chipHue(c.key);
          return (
            <Pressable
              key={String(c.key ?? "any")}
              onPress={() => {
                void triggerHapticSelection();
                onChange(c.key);
              }}
              style={[styles.chip, active && { backgroundColor: hue, borderColor: hue }]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Show ${c.label}`}
            >
              {c.key != null && !active && <View style={[styles.dot, { backgroundColor: hue }]} />}
              <Text style={[styles.chipText, active && styles.chipTextActive]} maxFontSizeMultiplier={FONT_CAP.chrome}>{c.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {!!note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 10, paddingRight: spacing.md },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontSize: 13, fontWeight: "700", color: colors.ink },
  chipTextActive: { color: "#fff" },
  note: { fontSize: 12, color: colors.mute, marginBottom: 4, lineHeight: 17 },
});
