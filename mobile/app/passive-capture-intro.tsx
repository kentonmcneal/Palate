import { useCallback, useRef, useState } from "react";
import { View, StyleSheet, Alert, Linking, ScrollView, Pressable } from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { colors, spacing, type } from "../theme";
import { Button, Spacer } from "../components/Button";
import { track } from "../lib/analytics";
import { requestWhenInUse, requestAlways, hasWhenInUse, hasAlways } from "../lib/passive-permissions";
import { setPassiveOptIn, startPassiveCaptureIfEnabled, type StartResult } from "../lib/passive-capture";
import { ensureNotificationPermission } from "../lib/notifications";

import { accountWriteSession } from "../lib/account-write";

type Step = "value" | "needs-settings" | "result";
type IntroStartResult = StartResult | { started: false; reason: "unknown" };

export default function PassiveCaptureIntro() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [step, setStep] = useState<Step>("value");
  const [busy, setBusy] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [result, setResult] = useState<IntroStartResult | null>(null);
  const [saved, setSaved] = useState(false);
  const active = useRef(false);
  const operation = useRef<object | null>(null);
  useFocusEffect(useCallback(() => {
    active.current = true;
    setBusy(false);
    void track("perm_prescreen_shown");
    return () => { active.current = false; operation.current = null; };
  }, []));

  function finish() {
    if (!active.current || operation.current) return;
    active.current = false;
    operation.current = null;
    if (next) router.replace(next as never);
    else router.back();
  }

  // One operation per focused screen. Every continuation checks ownership;
  // returning from phone Settings never writes consent or starts automatically.
  async function run(enable: boolean) {
    if (!active.current || operation.current) return;
    const ticket = {};
    operation.current = ticket;
    const account = accountWriteSession();
    const ownsOperation = () => active.current && operation.current === ticket;
    const current = () => ownsOperation() && accountWriteSession() === account;
    setBusy(true);
    try {
      if (enable) {
        setSaved(false);
        const alreadyGranted = await hasWhenInUse();
        if (!current()) return;
        const granted = alreadyGranted || await requestWhenInUse();
        if (!current()) return;
        if (!granted) {
          Alert.alert("Location is optional", "You can still add visits yourself and choose background suggestions later in Settings.");
          operation.current = null;
          setBusy(false);
          finish();
          return;
        }
        await ensureNotificationPermission();
        if (!current()) return;
        const always = await hasAlways();
        if (!current()) return;
        if (!always) {
          const outcome = await requestAlways();
          if (!current()) return;
          if (outcome !== "granted") { setStep("needs-settings"); return; }
        }
        await setPassiveOptIn(true);
        if (!current()) return;
        setSaved(true);
      }
      // Retry startup only: never rewrite consent after a newer opt-out.
      const nextResult = await startPassiveCaptureIfEnabled();
      if (!current()) return;
      setResult(nextResult);
      if (!nextResult.started && nextResult.reason === "not-opted-in") setSaved(false);
      setStep("result");
      void track("passive_opt_in_completed", {
        started: nextResult.started,
        reason: nextResult.started ? null : nextResult.reason,
      });
    } catch {
      if (current()) { setResult({ started: false, reason: "unknown" }); setStep("result"); }
    } finally {
      if (ownsOperation()) {
        operation.current = null; setBusy(false);
        if (accountWriteSession() !== account) {
          setSaved(false);
          setResult({ started: false, reason: "unknown" });
          setStep("result");
        }
      }
    }
  }

  async function openSettings() {
    if (!active.current || operation.current) return;
    const ticket = {};
    operation.current = ticket;
    setBusy(true);
    try { await Linking.openSettings(); }
    catch {
      if (active.current && operation.current === ticket) Alert.alert("Could not open Settings", "Open your phone's Settings, then choose Palate → Location.");
    } finally {
      if (active.current && operation.current === ticket) { operation.current = null; setBusy(false); }
    }
  }

  if (step === "needs-settings") return (
    <Screen footer={<>
      <Button title="Open iOS Settings" onPress={openSettings} loading={busy} />
      <Spacer /><Button title="Check permission and enable" onPress={() => run(true)} disabled={busy} />
      <Spacer /><Button title="Continue without enabling" variant="ghost" onPress={finish} disabled={busy} />
    </>}>
      <Text style={styles.h1}>Background permission is needed</Text>
      <Text style={styles.p}>Choose Always in Settings → Palate → Location if you want background suggestions. Then return here and check permission. You can also keep adding visits yourself.</Text>
    </Screen>
  );

  if (step === "result" && result) {
    const reason = result.started ? null : result.reason;
    const title = result.started ? "Background checks started"
      : reason === "not-opted-in" ? "Background checks did not start"
      : reason === "unknown" ? "We couldn't confirm setup"
      : "Your preference is saved";
    const detail = result.started
      ? "Palate can suggest places you may have stopped for food or coffee. Confirm a suggestion to add the visit to your diary. Dish details are optional. Some stops may be missed."
      : reason === "native-module-unavailable"
      ? "Background checks did not start. This app build does not support them. Check for an app update; you can still add visits yourself."
      : reason === "flag-off"
      ? "Background checks did not start because this feature is temporarily unavailable. Your saved preference allows checks to resume when it becomes available. You can turn it off in Settings."
      : reason === "no-always-permission"
      ? "Background checks did not start. Allow Always location access in your phone's Settings, then return and retry."
      : reason === "not-opted-in"
      ? "The start was cancelled or consent is off. Review your choice in Palate Settings. Retrying here will not turn consent back on."
      : saved
      ? "Your preference was saved, but we couldn't confirm whether background checks started. Retry the check or review your choice in Settings."
      : "We couldn't confirm your preference or start status. Review your choice in Settings; you can still add visits yourself.";
    return <Screen footer={<>
      {!result.started && reason === "no-always-permission" && <><Button title="Open iOS Settings" onPress={openSettings} disabled={busy} /><Spacer /></>}
      {!result.started && <><Button title="Retry background check" onPress={() => run(false)} loading={busy} /><Spacer /></>}
      <Button title="Continue" onPress={finish} disabled={busy} />
    </>}>
      <Text style={styles.h1}>{title}</Text><Text style={styles.p}>{detail}</Text>
      {result.started && <Text style={styles.p}>iOS may later ask you to confirm background access. Choose Always if you want to keep background suggestions. Reminders also depend on notification permission and your phone's delivery settings.</Text>}
    </Screen>;
  }

  return <Screen footer={<>
    <Button title="Enable background suggestions" onPress={() => run(true)} loading={busy} />
    <Spacer /><Button title="Not now" variant="ghost" onPress={finish} disabled={busy} />
  </>}>
    <Text style={styles.emoji}>📍🍽️</Text>
    <Text style={styles.h1}>Remember a stop for food or coffee</Text>
    <Text style={styles.p}>Palate can suggest places you visited while the app is closed. An evening reminder can help you review them. You confirm a suggestion before it becomes a diary visit.</Text>
    <Spacer />
    <Text style={styles.bullet}>• Background suggestions need Always location access.</Text>
    <Text style={styles.bullet}>• Some stops may be missed or matched to the wrong place.</Text>
    <Text style={styles.bullet}>• Add a visit yourself anytime.</Text>
    <Spacer />
    <Pressable onPress={() => setShowDetail(v => !v)} hitSlop={8} accessibilityRole="button" accessibilityState={{ expanded: showDetail }}>
      <Text style={styles.moreLink}>{showDetail ? "Hide the detail" : "How location is used"}</Text>
    </Pressable>
    {showDetail && <View style={styles.detail}>
      <Text style={styles.bullet}>Palate may send a stop's location to its servers and a places provider to identify nearby places. Suggested places and detection details may sync to your account before you confirm a visit.</Text>
      <Text style={styles.bullet}>Location helps suggest a place; it does not tell Palate what you ordered. Home and work filters run on your phone, but can make mistakes. Turn background suggestions off anytime in Palate Settings.</Text>
    </View>}
  </Screen>;
}

/**
 * Content scrolls; the buttons stay put.
 *
 * This used to be a plain `<View style={{flex:1}}>` holding a flex:1 centred
 * block and a footer. A View does not scroll, so on a shorter phone -- or at
 * any larger Dynamic Type setting -- the six bullets simply drew straight over
 * the "Not now" button, which is what a tester photographed. The permission
 * screen for the app's central feature was unreadable and its escape hatch was
 * covered.
 *
 * flexGrow:1 + justifyContent:center keeps the short variants vertically
 * centred exactly as before, and lets the long one scroll instead of overflow.
 */
function Screen({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { flexGrow: 1, justifyContent: "center", padding: spacing.lg, paddingBottom: spacing.md },
  // Sits outside the scroller so the buttons are always reachable.
  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, paddingTop: spacing.sm },
  emoji: { fontSize: 40, marginBottom: spacing.lg },
  h1: { ...type.display, color: colors.ink },
  p: { ...type.body, color: colors.mute, marginTop: spacing.md },
  bulletStrong: { fontWeight: "800", color: colors.ink },
  bullet: { ...type.body, color: colors.ink, marginTop: 8 },
  moreLink: { ...type.body, color: colors.redText, fontWeight: "700" },
  detail: { marginTop: 4 },
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
