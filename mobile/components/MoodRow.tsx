import { ScrollView, StyleSheet, Text, Pressable, View } from "react-native";
import { colors, spacing } from "../theme";
import { triggerHapticSelection } from "../lib/haptics";
import type { Mood, MoodChip } from "../lib/mood";

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
  if (chips.length <= 2) return null; // just Anything + Surprise: nothing to say yet

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {chips.map((c) => {
          const active = c.key === value;
          return (
            <Pressable
              key={String(c.key ?? "any")}
              onPress={() => {
                void triggerHapticSelection();
                onChange(c.key);
              }}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Show ${c.label}`}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
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
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 13, fontWeight: "700", color: colors.ink },
  chipTextActive: { color: "#fff" },
  note: { fontSize: 12, color: colors.mute, marginBottom: 4, lineHeight: 17 },
});
