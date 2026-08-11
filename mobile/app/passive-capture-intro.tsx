import { useEffect } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { Button, Spacer } from "../components/Button";
import { track } from "../lib/analytics";
import { requestWhenInUse } from "../lib/passive-permissions";
import { startPassiveCaptureIfEnabled } from "../lib/passive-capture";
import { ensureNotificationPermission } from "../lib/notifications";

// Custom pre-permission screen. We explain the value and get a soft yes BEFORE
// ever touching the system dialog — firing the OS prompt cold is how opt-in dies.
export default function PassiveCaptureIntro() {
  const router = useRouter();

  useEffect(() => {
    void track("perm_prescreen_shown");
  }, []);

  async function onEnable() {
    try {
      void track("perm_prescreen_accepted");
      const granted = await requestWhenInUse();
      if (!granted) {
        Alert.alert(
          "No problem",
          "You can still log meals yourself. Turn this on anytime in Settings.",
        );
        router.back();
        return;
      }
      // Ask for notifications now too — confirmations are the payoff, and a
      // visit detected later can't prompt without this.
      await ensureNotificationPermission();
      // When-In-Use is enough to begin; Always is upgraded later, after the user
      // has seen the payoff (a confirmed visit). Start capture if the flag is on.
      await startPassiveCaptureIfEnabled();
      router.back();
    } catch {
      // Never let a rejected permission/start call escape as an unhandled
      // rejection (New-Arch fatal pattern). Degrade to manual silently.
      router.back();
    }
  }

  function onNotNow() {
    void track("perm_prescreen_dismissed");
    router.back(); // never a dead end
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <Text style={styles.emoji}>📍🍽️</Text>
          <Text style={styles.h1}>Log where you ate without opening the app</Text>
          <Text style={styles.p}>
            Palate can notice when you've spent time at a restaurant and ask you — with one tap — if
            you ate there. No check-ins, no manual logging.
          </Text>
          <Spacer />
          <Text style={styles.bullet}>• You confirm every visit. Nothing is logged silently.</Text>
          <Text style={styles.bullet}>• Your location stays on your device. We never sell it.</Text>
          <Text style={styles.bullet}>• Turn it off anytime in Settings.</Text>
        </View>

        <View>
          <Button title="Enable passive logging" onPress={onEnable} />
          <Spacer />
          <Button title="Not now" variant="ghost" onPress={onNotNow} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { flex: 1, padding: spacing.lg, paddingBottom: spacing.xl },
  emoji: { fontSize: 40, marginBottom: spacing.lg },
  h1: { ...type.display, color: colors.ink },
  p: { ...type.body, color: colors.mute, marginTop: spacing.md },
  bullet: { ...type.body, color: colors.ink, marginTop: 8 },
});
