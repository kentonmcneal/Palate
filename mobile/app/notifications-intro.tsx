import { useState } from "react";
import { View, StyleSheet, Linking } from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { colors, spacing, type } from "../theme";
import { Button, Spacer } from "../components/Button";
import { track } from "../lib/analytics";
import { requestPushPermission, type PushAsk } from "../lib/notifications";
import { markPrimerSeen } from "../lib/notification-primer";

// The notification ask, with the reasons in front of it.
//
// iOS shows its permission dialog once. Until this screen existed the app
// fired it on first launch with no context, and most people said no. This
// says what the three notifications are, in the order they matter, and then
// asks. Somebody who already said no at the system level cannot be asked
// again, so they get the Settings route instead of a dialog that will not
// appear.
type Step = "value" | "needs-settings" | "done";

export default function NotificationsIntro() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [step, setStep] = useState<Step>("value");
  const [busy, setBusy] = useState(false);

  function finish() {
    markPrimerSeen();
    router.replace((next as never) ?? ("/(tabs)" as never));
  }

  async function turnOn() {
    setBusy(true);
    let result: PushAsk = "denied";
    try {
      result = await requestPushPermission();
    } finally {
      setBusy(false);
    }
    void track("notif_primer_answered", { result });
    if (result === "granted") { setStep("done"); return; }
    if (result === "blocked") { setStep("needs-settings"); return; }
    finish();
  }

  function notNow() {
    void track("notif_primer_answered", { result: "not_now" });
    finish();
  }

  if (step === "needs-settings") {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.body}>
          <Text style={styles.emoji}>🔕</Text>
          <Text style={styles.h1}>Notifications are off for Palate</Text>
          <Text style={styles.p}>
            iOS only asks once, and it has already been answered. To turn them on,
            open Settings, find Palate, and allow notifications.
          </Text>
          <View style={{ flex: 1 }} />
          <Button title="Open iOS Settings" onPress={() => Linking.openSettings()} />
          <Spacer />
          <Button title="Not now" variant="ghost" onPress={finish} />
        </View>
      </SafeAreaView>
    );
  }

  if (step === "done") {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.body}>
          <Text style={styles.emoji}>✅</Text>
          <Text style={styles.h1}>You're set</Text>
          <Text style={styles.p}>
            Nothing arrives late at night, and never more than a few a day.
          </Text>
          <View style={{ flex: 1 }} />
          <Button title="Continue" onPress={finish} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={styles.emoji}>🔔</Text>
        <Text style={styles.h1}>Three things worth a tap</Text>
        <Text style={styles.p}>
          Palate is quiet by default. These are the only times it reaches out.
        </Text>
        <Spacer />
        <View style={styles.card}>
          <Text style={styles.cardTitle}>A friend just ate somewhere</Text>
          <Text style={styles.cardBody}>
            When someone you follow logs a visit, you hear about it. That is the
            whole social side of the app.
          </Text>
        </View>
        <Spacer size={10} />
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your evening digest</Text>
          <Text style={styles.cardBody}>
            If Palate noticed you at a restaurant today, one message at 9pm asks
            whether to keep it. Never in the middle of a meal.
          </Text>
        </View>
        <Spacer size={10} />
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sunday Wrapped</Text>
          <Text style={styles.cardBody}>
            Once a week, what your palate did.
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Button title="Turn on notifications" onPress={turnOn} loading={busy} />
        <Spacer />
        <Button title="Not now" variant="ghost" onPress={notNow} />
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
