import { useState } from "react";
import { View, StyleSheet, Alert, Linking } from "react-native";
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
      <View style={styles.body}>
        <Text style={styles.h1}>Allow location</Text>
        <Spacer />
        <Text style={styles.p}>
          iOS asks in two steps. Tap "Allow While Using the App" first — then
          Palate asks once more for "Always," which is the one that matters.
        </Text>
        <Spacer size={28} />
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Why "Always"</Text>
          <Text style={styles.cardBody}>
            Palate logs where you eat without you doing anything — but your phone
            is in your pocket while you eat, so the app is in the background.
            "While Using the App" means it can only see somewhere you were
            standing with Palate open, which is almost never.
          </Text>
          <Spacer size={12} />
          <Text style={styles.cardBody}>
            With "Always," you get one summary at the end of the day asking you to
            confirm where you ate. Without it, you're back to typing every meal in
            yourself. We never sell your location, and you can turn it off any time.
          </Text>
        </View>
      </View>
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
  safe: { flex: 1, backgroundColor: colors.paper, justifyContent: "space-between" },
  body: { padding: spacing.lg, paddingTop: spacing.xxl },
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
