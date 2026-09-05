import { View, Pressable, StyleSheet } from "react-native";
import { Text } from "./Text";
import { colors, spacing, type } from "../theme";
import { loadErrorMessage } from "../lib/load-state";

/**
 * What a screen shows when its data did not arrive.
 *
 * Deliberately not the empty state. Every list in this app used to catch a
 * failure into a console.warn and render "nothing here", so a broken request
 * and an empty result looked identical — and the one screen where that
 * mattered most was wrong for its entire existence without anybody noticing.
 */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{loadErrorMessage(error)}</Text>
      <Pressable onPress={onRetry} style={styles.btn} accessibilityRole="button">
        <Text style={styles.btnText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.lg, padding: spacing.lg, borderRadius: 18,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.faint,
    alignItems: "center",
  },
  title: { ...type.subtitle, color: colors.ink, textAlign: "center", lineHeight: 22 },
  btn: {
    marginTop: spacing.md, paddingHorizontal: 20, paddingVertical: 11,
    borderRadius: 999, backgroundColor: colors.red,
  },
  btnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
});
