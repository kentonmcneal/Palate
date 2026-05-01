import { useEffect, useState } from "react";
import { Modal, View, Text, StyleSheet, Pressable, Alert, Linking } from "react-native";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, spacing, type } from "../theme";

const KEY = "palate.autoDetect.asked";
const TRIGGER_AT = 3; // Show after 3rd check-in

type Props = {
  visitsTotal: number;
};

export function AutoDetectPrompt({ visitsTotal }: Props) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visitsTotal < TRIGGER_AT) return;
    let alive = true;
    (async () => {
      const asked = await AsyncStorage.getItem(KEY);
      if (asked === "1") return;
      // Only show if foreground permission already granted (otherwise the
      // background ask iOS shows is confusing).
      const fg = await Location.getForegroundPermissionsAsync();
      if (fg.status !== "granted") return;
      const bg = await Location.getBackgroundPermissionsAsync();
      if (bg.status === "granted") return;
      if (alive) setVisible(true);
    })();
    return () => { alive = false; };
  }, [visitsTotal]);

  async function dismiss(saveAsked = true) {
    if (saveAsked) await AsyncStorage.setItem(KEY, "1");
    setVisible(false);
  }

  async function handleYes() {
    setBusy(true);
    try {
      const result = await Location.requestBackgroundPermissionsAsync();
      if (result.status === "granted") {
        Alert.alert("On", "Palate will now nudge you when you're at a new restaurant.");
      } else if (result.status === "denied") {
        Alert.alert(
          "iOS needs you to flip this",
          "iOS only lets you change to 'Always Allow' from Settings → Palate → Location. We can take you there.",
          [
            { text: "Open Settings", onPress: () => Linking.openSettings() },
            { text: "Not now" },
          ],
        );
      }
    } finally {
      setBusy(false);
      await dismiss();
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => dismiss()}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>YOU'RE GETTING THE HANG OF IT</Text>
          <Text style={styles.title}>Want Palate to log places automatically?</Text>
          <Text style={styles.body}>
            We've learned three of your spots. If you flip on Always Allow, Palate
            will spot when you're at a new restaurant and nudge you to confirm —
            no more tapping "Check now."
          </Text>
          <Text style={styles.fineprint}>
            iOS will ask if you want to upgrade to Always Allow. You can flip
            it back anytime in Settings.
          </Text>
          <View style={styles.row}>
            <Pressable onPress={() => dismiss()} style={styles.btnGhost}>
              <Text style={styles.btnGhostText}>Not now</Text>
            </Pressable>
            <Pressable onPress={handleYes} style={styles.btnPrimary} disabled={busy}>
              <Text style={styles.btnPrimaryText}>{busy ? "…" : "Turn it on"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1, backgroundColor: "rgba(15,15,15,0.55)",
    alignItems: "center", justifyContent: "center", padding: spacing.lg,
  },
  card: {
    width: "100%", maxWidth: 380,
    backgroundColor: colors.paper, borderRadius: 22, padding: spacing.lg,
  },
  eyebrow: { ...type.micro, color: colors.red },
  title: { fontSize: 22, fontWeight: "800", color: colors.ink, letterSpacing: -0.4, marginTop: 8, lineHeight: 28 },
  body: { ...type.body, color: colors.ink, marginTop: 12, lineHeight: 22 },
  fineprint: { ...type.small, marginTop: 10, lineHeight: 18 },
  row: { flexDirection: "row", gap: 10, marginTop: 18 },
  btnGhost: {
    flex: 1, paddingVertical: 12, borderRadius: 14,
    backgroundColor: colors.faint, alignItems: "center",
  },
  btnGhostText: { fontSize: 14, fontWeight: "700", color: colors.mute },
  btnPrimary: {
    flex: 1, paddingVertical: 12, borderRadius: 14,
    backgroundColor: colors.red, alignItems: "center",
  },
  btnPrimaryText: { color: "#fff", fontSize: 14, fontWeight: "800" },
});
