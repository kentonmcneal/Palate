import { useEffect } from "react";
import { View, StyleSheet, Pressable, Linking } from "react-native";
import { Text } from "./Text";
import { colors, spacing, type } from "../theme";
import { track } from "../lib/analytics";

// Persistent, dismissible banner shown when Always location was revoked while
// passive capture was on. iOS downgrades silently, so we detect on foreground
// (see passive-permissions.checkPermissionDowngrade) and surface a one-tap
// deep link to Settings. Degrade, don't nag — it's dismissible.
export function PermissionRepairBanner({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (visible) void track("perm_repair_banner_shown");
  }, [visible]);

  if (!visible) return null;

  function onFix() {
    void track("perm_repair_tapped");
    void Linking.openSettings();
  }

  return (
    <View style={styles.wrap}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Palate isn\u2019t logging your visits</Text>
        <Text style={styles.sub}>It needs Location set to “Always”. Your phone is in your pocket while you eat.</Text>
      </View>
      <Pressable onPress={onFix} style={styles.fixBtn} hitSlop={6}>
        <Text style={styles.fixText}>Fix</Text>
      </Pressable>
      <Pressable onPress={onDismiss} hitSlop={10}>
        <Text style={styles.dismiss}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  title: { ...type.small, color: colors.ink, fontWeight: "800" },
  sub: { ...type.small, color: colors.mute, marginTop: 2 },
  fixBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.red,
  },
  fixText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  dismiss: { color: colors.mute, fontSize: 16, fontWeight: "700", paddingHorizontal: 4 },
});
