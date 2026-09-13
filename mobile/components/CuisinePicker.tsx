// ----------------------------------------------------------------------------
// CuisinePicker — "what cuisine is it?", with all the answers.
// ----------------------------------------------------------------------------
// Replaces an Alert.alert holding eight hard-coded choices. An iOS alert stacks
// its buttons vertically and has no scroll, so it could never have held the
// twenty-five values the catalogue actually uses -- which is why `american`,
// the most common cuisine in the whole database, was missing from a corrector
// whose entire job is fixing wrong cuisines.
// ----------------------------------------------------------------------------
import { Modal, View, StyleSheet, Pressable, ScrollView } from "react-native";
import { Text } from "./Text";
import { colors, radius, spacing, type } from "../theme";
import { FONT_CAP } from "../lib/a11y";
import { CUISINES, cuisineLabel } from "../lib/cuisines";

export function CuisinePicker({
  visible, current, onPick, onClose,
}: {
  visible: boolean;
  /** Highlighted so the sheet shows what it is changing FROM. */
  current?: string | null;
  onPick: (cuisine: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.wrap}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={[type.cardTitle, styles.h]} maxFontSizeMultiplier={FONT_CAP.chrome}>
            What cuisine is it?
          </Text>
          <Text style={styles.sub}>We'll update this place for everyone.</Text>

          <ScrollView style={styles.list} contentContainerStyle={styles.listInner}>
            {CUISINES.map((c) => {
              const active = current?.toLowerCase() === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => onPick(c)}
                  style={[styles.item, active && styles.itemActive]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.itemText, active && styles.itemTextActive]}>
                    {cuisineLabel(c)}
                  </Text>
                  {active && <Text style={styles.currentTag}>current</Text>}
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable onPress={onClose} style={styles.cancel} accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  wrap: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.faint,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg, paddingTop: 10, paddingBottom: 28,
    maxHeight: "80%",
  },
  grabber: {
    alignSelf: "center", width: 38, height: 4, borderRadius: 2,
    backgroundColor: colors.wash, marginBottom: 10,
  },
  h: { marginBottom: 2 },
  sub: { fontSize: 13, color: colors.mute, marginBottom: 12 },
  list: { flexGrow: 0 },
  listInner: { gap: 8, paddingBottom: 8 },
  item: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.wash, borderRadius: 999,
    paddingVertical: 13, paddingHorizontal: 18,
  },
  itemActive: { backgroundColor: colors.redTint, borderWidth: 1, borderColor: colors.redTintBorder },
  itemText: { fontSize: 16, fontWeight: "600", color: colors.ink },
  itemTextActive: { color: colors.redText },
  currentTag: { fontSize: 11, fontWeight: "800", color: colors.redText, letterSpacing: 0.5 },
  cancel: { alignItems: "center", paddingVertical: 14, marginTop: 6 },
  cancelText: { fontSize: 15, fontWeight: "700", color: colors.mute },
});
