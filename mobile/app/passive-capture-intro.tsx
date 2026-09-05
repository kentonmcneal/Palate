import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { colors, spacing, type } from "../theme";
import { Button, Spacer } from "../components/Button";
import { track } from "../lib/analytics";
import { requestWhenInUse, requestAlways, hasWhenInUse, hasAlways } from "../lib/passive-permissions";
import { setPassiveOptIn, startPassiveCaptureIfEnabled } from "../lib/passive-capture";
import { ensureNotificationPermission } from "../lib/notifications";

// Custom pre-permission screen for passive dining capture.
//
// The funnel deliberately shows ONE in-app screen and then no cold system modal
// for background location. Sequence:
//   value screen -> When-In-Use prompt -> notifications -> Always (silent)
// Asking for Always while the app already holds When-In-Use gets a PROVISIONAL
// grant: iOS shows nothing, we register CLVisit right away, and iOS prompts the
// user itself later — once it can show real usage context. That is a far better
// ask than a modal fired at someone who has not seen the feature work yet.
//
// Because that system prompt arrives later and unannounced, the success screen
// pre-teaches the answer ("choose Always Allow"). Priming it is the single
// highest-leverage thing we can do for conversion, since we never get to place
// that dialog ourselves.
type Step = "value" | "needs-settings" | "done";

export default function PassiveCaptureIntro() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [step, setStep] = useState<Step>("value");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void track("perm_prescreen_shown");
  }, []);

  function finish() {
    if (next) router.replace(next as never);
    else router.back();
  }

  // Opt in, then start monitoring. A flag-off or missing-native-module result
  // still keeps the opt-in: the foreground resume path picks it up once the
  // kill switch flips or the user updates the app.
  async function completeOptIn() {
    await setPassiveOptIn(true);
    const r = await startPassiveCaptureIfEnabled();
    void track("passive_opt_in_completed", {
      started: r.started,
      reason: r.started ? null : r.reason,
    });
    if (!r.started && r.reason === "native-module-unavailable") {
      Alert.alert(
        "Update Palate to finish",
        "Background logging needs the latest version of the app. We've saved your choice. It turns on once you update.",
      );
    }
    setStep("done");
  }

  async function onEnable() {
    setBusy(true);
    try {
      void track("perm_prescreen_accepted");
      const granted = (await hasWhenInUse()) || (await requestWhenInUse());
      if (!granted) {
        Alert.alert(
          "No problem",
          "You can still log meals yourself. Turn this on anytime in Settings.",
        );
        finish();
        return;
      }
      // Ask for notifications now too — the confirmation prompt IS the payoff,
      // and a visit detected later can't ask for anything without this.
      await ensureNotificationPermission();

      // Already holding Always (re-running the funnel) — nothing left to ask.
      if (await hasAlways()) {
        await completeOptIn();
        return;
      }

      // The silent step. On the happy path the user sees no dialog at all.
      const outcome = await requestAlways();
      if (outcome === "granted") await completeOptIn();
      else setStep("needs-settings");
    } catch {
      // Never let a rejected permission call escape as an unhandled rejection
      // (New-Arch fatal pattern). Degrade to manual silently.
      finish();
    } finally {
      setBusy(false);
    }
  }

  function onNotNow() {
    void track("perm_prescreen_dismissed", { step });
    finish(); // never a dead end
  }

  if (step === "needs-settings") {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <Text style={styles.emoji}>⚙️</Text>
          <Text style={styles.h1}>Background logging is still off</Text>
          <Text style={styles.p}>
            iOS is holding location to "While Using the App." You can switch it to Always in
            Settings → Palate → Location, or skip it and keep logging meals yourself.
          </Text>
        </View>
        <View>
          <Button title="Open iOS Settings" onPress={() => Linking.openSettings()} />
          <Spacer />
          <Button title="Not now" variant="ghost" onPress={onNotNow} />
        </View>
      </Screen>
    );
  }

  if (step === "done") {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <Text style={styles.emoji}>✅</Text>
          <Text style={styles.h1}>You're set — go eat</Text>
          <Text style={styles.p}>
            Next time you spend a while at a restaurant, we'll ask if you ate there. One tap and
            it's logged. Nothing is saved until you confirm it.
          </Text>
          <Spacer />
          <View style={styles.card}>
            <Text style={styles.cardTitle}>One heads-up</Text>
            <Text style={styles.cardBody}>
              In a few days iOS will ask whether Palate can keep using your location in the
              background, and show you a map of where it checked. Tap "Change to Always Allow" —
              if you pick "Keep Only While Using," passive logging stops.
            </Text>
          </View>
        </View>
        <View>
          <Button title="Done" onPress={finish} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Text style={styles.emoji}>📍🍽️</Text>
        <Text style={styles.h1}>Log where you ate without opening the app</Text>
        <Text style={styles.p}>
          Palate can notice when you've spent time at a restaurant and ask you — with one tap — if
          you ate there. No check-ins, no manual logging.
        </Text>
        <Spacer />
        <Text style={styles.bullet}>• You confirm every visit. Nothing is logged silently.</Text>
        <Text style={styles.bullet}>• We only look at where you stopped, not everywhere you go.</Text>
        <Text style={styles.bullet}>• Home and work are filtered out on your phone.</Text>
        <Text style={styles.bullet}>• Turn it off anytime in Settings.</Text>
      </View>

      <View>
        <Button title="Enable passive logging" onPress={onEnable} loading={busy} />
        <Spacer />
        <Button title="Not now" variant="ghost" onPress={onNotNow} />
      </View>
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>{children}</View>
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
