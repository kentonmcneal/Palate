import { useState } from "react";
import { View, ScrollView, StyleSheet, Alert, Linking } from "react-native";
import { Text } from "../../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { requestForegroundPermission } from "../../lib/location";
import { track } from "../../lib/analytics";
import { isFlagEnabled } from "../../lib/flags";
import { PASSIVE_CAPTURE_FLAG } from "../../lib/passive-capture";

export default function Permission() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleAllow() {
    setLoading(true);
    try {
      const { granted, status } = await requestForegroundPermission();
      if (granted) {
        void track("permission_granted", { kind: "foreground" });
        // Offer background logging while location is already top of mind. Gated
        // on the kill switch so onboarding is untouched when the feature is off,
        // and skippable — the intro routes on to privacy either way.
        const passiveOn = await isFlagEnabled(PASSIVE_CAPTURE_FLAG).catch(() => false);
        if (passiveOn) {
          router.push({
            pathname: "/passive-capture-intro",
            params: { next: "/onboarding/email" },
          });
        } else {
          router.push("/onboarding/email");
        }
      } else if (status === "denied") {
        void track("permission_denied", { kind: "foreground" });
        Alert.alert(
          "Location is off",
          "You can still use Palate by adding visits manually. To turn location on, open Settings → Palate → Location.",
          [
            { text: "Open Settings", onPress: () => Linking.openSettings() },
            { text: "Continue without", onPress: () => router.push("/onboarding/privacy") },
          ],
        );
      } else {
        // Neither granted nor denied (dialog dismissed, restricted, unknown):
        // onboarding dead-ended here. Move on; the Home card re-asks later.
        router.push("/onboarding/privacy");
      }
    } catch {
      // A native rejection (not a plain "denied" status) would otherwise escape
      // as an unhandled promise rejection — which the React ErrorBoundary can't
      // catch. Degrade gracefully so onboarding never dead-ends here.
      Alert.alert(
        "Location unavailable",
        "We couldn't request location right now. You can continue and add visits manually.",
        [{ text: "Continue", onPress: () => router.push("/onboarding/privacy") }],
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Scrolls. A plain View does not, so at any larger Dynamic Type setting
          the card simply drew over the buttons below it and the screen's only
          escape hatch went off-screen. Same fix, and same reason, as
          passive-capture-intro. The CTA stays OUTSIDE the scroller so the
          buttons are reachable no matter how tall the copy gets. */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.h1}>Allow location</Text>
        <Spacer />
        <Text style={styles.p}>
          Allow location to find nearby places while you use Palate. Background
          suggestions are a separate, optional choice that needs Always access.
        </Text>
        <Spacer size={28} />
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Why "Always"</Text>
          <Text style={styles.cardBody}>
            With background suggestions enabled, Palate can suggest stops for food
            or coffee while the app is closed. Some stops may be missed or matched
            to the wrong place. Confirm a suggestion before adding it to your diary.
          </Text>
          <Spacer size={12} />
          <Text style={styles.cardBody}>
            An evening reminder can help you review suggestions; delivery is not
            guaranteed. You can also find nearby places while using Palate or add
            a visit yourself. Dish details are optional. We never sell your location.
            Manage background suggestions in Settings.
          </Text>
        </View>
      </ScrollView>
      <View style={styles.cta}>
        <Button title="Allow location" onPress={handleAllow} loading={loading} />
        <Spacer />
        <Button
          title="Skip for now"
          variant="ghost"
          onPress={() => router.push("/onboarding/privacy")}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { flexGrow: 1, padding: spacing.lg, paddingTop: spacing.xxl },
  cta: { padding: spacing.lg },
  h1: { ...type.display, color: colors.ink },
  p: { ...type.body, color: colors.mute, lineHeight: 24 },
  card: {
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 18,
    padding: spacing.lg,
    backgroundColor: colors.faint,
  },
  cardTitle: { ...type.subtitle, color: colors.ink },
  cardBody: { ...type.body, color: colors.mute, marginTop: 6, lineHeight: 22 },
});
