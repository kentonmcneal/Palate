import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Switch, Alert, Linking, ScrollView, Share, Pressable, Modal, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Button, Spacer } from "../components/Button";
import { colors, spacing, type } from "../theme";
import { supabase } from "../lib/supabase";
import { signOut } from "../lib/auth";
import { generateForCurrentWeek } from "../lib/wrapped";
import {
  isReminderEnabled,
  enableSundayWrappedReminder,
  disableSundayWrappedReminder,
} from "../lib/notifications";
import {
  isScreenshotPromptEnabled,
  setScreenshotPromptEnabled,
} from "../lib/screenshot-feedback";
import {
  areDiscoveryPingsEnabled,
  setDiscoveryPingsEnabled,
} from "../lib/notification-schedule";
import { isFriendActivityPushEnabled, setFriendActivityPushEnabled } from "../lib/friend-push";
import { listIncomingRequests } from "../lib/friends";
import { generateInviteLink, inviteShareMessage, getMyReferralCount } from "../lib/referrals";
import { GmailImportCard } from "../components/GmailImportCard";
import { isFlagEnabled } from "../lib/flags";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { isAdmin } from "../lib/waitlist";
import { ensureAutoDetectPermission, setAutoDetectEnabled, TRACKING_PAUSED_KEY } from "../lib/auto-detect";
import {
  isPassiveOptedIn,
  optOutOfPassiveCapture,
  setPassiveOptIn,
  startPassiveCaptureIfEnabled,
  PASSIVE_CAPTURE_FLAG,
} from "../lib/passive-capture";
import { hasAlways } from "../lib/passive-permissions";


const PAUSE_KEY = TRACKING_PAUSED_KEY;

export default function Settings() {
  const router = useRouter();
  const [tracking, setTracking] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [sundayReminder, setSundayReminder] = useState(false);
  const [screenshotPrompt, setScreenshotPrompt] = useState(true);
  const [discoveryPings, setDiscoveryPings] = useState(true);
  const [friendPush, setFriendPush] = useState(true);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [referralCount, setReferralCount] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(PAUSE_KEY).then((v) => setTracking(v !== "1"));
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    isReminderEnabled().then(setSundayReminder);
    isScreenshotPromptEnabled().then(setScreenshotPrompt);
    areDiscoveryPingsEnabled().then(setDiscoveryPings);
    isFriendActivityPushEnabled().then(setFriendPush);
    listIncomingRequests().then((rs) => setPendingRequestCount(rs.length)).catch(() => {});
    getMyReferralCount().then(setReferralCount).catch(() => {});
  }, []);

  async function inviteFriends() {
    try {
      const link = await generateInviteLink();
      await Share.share({
        title: "Palate",
        message: inviteShareMessage(link),
        url: link,
      });
    } catch {
      // user cancelled — silent
    }
  }

  async function toggleSundayReminder(next: boolean) {
    if (next) {
      const result = await enableSundayWrappedReminder();
      if (result.ok) {
        setSundayReminder(true);
      } else if (result.reason === "denied") {
        Alert.alert(
          "Notifications off",
          "Allow notifications in iOS Settings → Palate to get the Sunday Wrapped reminder.",
          [
            { text: "Open Settings", onPress: () => Linking.openSettings() },
            { text: "Not now" },
          ],
        );
      } else {
        Alert.alert("Couldn't enable", "Try again in a moment.");
      }
    } else {
      await disableSundayWrappedReminder();
      setSundayReminder(false);
    }
  }

  async function toggleTracking(next: boolean) {
    setTracking(next);
    await setAutoDetectEnabled(next);
    if (next) {
      const { granted } = await ensureAutoDetectPermission();
      if (!granted) {
        Alert.alert(
          "Auto-detect needs location access to suggest visits.",
          "Allow location in iOS Settings → Palate, or turn this off.",
          [
            { text: "Open Settings", onPress: () => Linking.openSettings() },
            { text: "Not now" },
          ],
        );
      }
    }
  }

  async function manualGenerate() {
    try {
      const w = await generateForCurrentWeek();
      if (!w) Alert.alert("Add a visit first", "Once you've logged at least one this week, try again.");
      else Alert.alert("Done", "Your Wrapped was refreshed.");
    } catch (e: any) {
      Alert.alert("Couldn't generate", e.message ?? "Try again");
    }
  }

  function deleteHistory() {
    Alert.alert("Delete all visit history?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase.rpc("delete_my_history");
          if (error) Alert.alert("Failed", error.message);
          else Alert.alert("Cleared", "Your visit history is empty.");
        },
      },
    ]);
  }

  function deleteAccount() {
    Alert.alert(
      "Delete account?",
      "This wipes everything: account, visits, location events. You can't undo this.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete forever",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase.rpc("delete_my_account");
            if (error) {
              Alert.alert("Failed", error.message);
            } else {
              await signOut();
              router.replace("/sign-in");
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Settings is a pushed route behind the gear on the Profile tab, not a
          tab of its own, so it owns a back affordance. */}
      <View style={styles.navHeader}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button">
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={type.title}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.container}>
        <Section title="Bring in your history">
          <GmailImportCard />
        </Section>

        <Section title="Friends">
          <Button
            title="Leaderboard"
            onPress={() => router.push({ pathname: "/friends", params: { tab: "leaderboard" } })}
          />
          <Spacer />
          <Button
            title={`Manage friends${pendingRequestCount > 0 ? ` · ${pendingRequestCount} request${pendingRequestCount === 1 ? "" : "s"}` : ""}`}
            onPress={() => router.push("/friends")}
            variant="ghost"
          />
          <Spacer />
          <Button
            title={referralCount > 0 ? `Share Palate · ${referralCount} invited` : "Share Palate with someone"}
            onPress={inviteFriends}
            variant="ghost"
          />
          <Note>
            {referralCount > 0
              ? `${referralCount} ${referralCount === 1 ? "person has" : "people have"} signed up from your invites. Your invite link auto-credits when they join.`
              : "Send a personal invite link. We'll credit you when they sign up."}
          </Note>
        </Section>

        <Section title="Photos">
          <Button
            title="Your meal photos"
            onPress={() => router.push("/photos")}
            variant="ghost"
          />
          <Note>Every photo you've added to a visit, in one grid.</Note>
        </Section>

        <Section title="Passive tracking">
          <Row label="Check when I open the app" right={<Switch value={tracking} onValueChange={toggleTracking} thumbColor={tracking ? colors.red : "#fff"} trackColor={{ true: colors.redTintBorder, false: colors.line }} />} />
          <Note>Looks for a nearby restaurant each time you open Palate.</Note>
          <PassiveCaptureEntry />
        </Section>

        <PassiveInboxEntry />
        <AdminEntry />

        <CollapsibleSection title="Wrapped & reminders">
          <Row label="Sunday Wrapped reminder" right={<Switch value={sundayReminder} onValueChange={toggleSundayReminder} thumbColor={sundayReminder ? colors.red : "#fff"} trackColor={{ true: colors.redTintBorder, false: colors.line }} />} />
          <Note>One reminder a week, Sunday at 9 AM. That's it.</Note>
          <Row
            label="Activity from other people"
            right={
              <Switch
                value={friendPush}
                onValueChange={(v) => { setFriendPush(v); void setFriendActivityPushEnabled(v); }}
                thumbColor={friendPush ? colors.red : "#fff"}
                trackColor={{ true: colors.redTintBorder, false: colors.line }}
              />
            }
          />
          <Note>New people joining, Wrapped results, and friends&apos; visits. Your own activity is only shared as far as your profile visibility allows.</Note>
          <Row
            label="Weekend picks"
            right={
              <Switch
                value={discoveryPings}
                onValueChange={(v) => { setDiscoveryPings(v); void setDiscoveryPingsEnabled(v); }}
                thumbColor={discoveryPings ? colors.red : "#fff"}
                trackColor={{ true: colors.redTintBorder, false: colors.line }}
              />
            }
          />
          <Note>Friday date night, Saturday brunch, and one Thursday left turn. Three a week, none after 6 PM.</Note>
          <Row
            label="Ask for feedback after a screenshot"
            right={
              <Switch
                value={screenshotPrompt}
                onValueChange={(v) => { setScreenshotPrompt(v); void setScreenshotPromptEnabled(v); }}
                thumbColor={screenshotPrompt ? colors.red : "#fff"}
                trackColor={{ true: colors.redTintBorder, false: colors.line }}
              />
            }
          />
          <Note>At most once a day. We never see the screenshot itself.</Note>
          <Spacer />
          <Button title="Open this week's Wrapped" onPress={() => router.push("/(tabs)/wrapped")} />
          <Spacer />
          <Button title="Generate this week's Wrapped" onPress={manualGenerate} variant="ghost" />
          <Spacer />
          <Button
            title="Preview Year in Palate (December)"
            onPress={() => router.push("/year-in-review")}
            variant="ghost"
          />
        </CollapsibleSection>

        {/* Insights section removed — all of that content (Palate Lore,
            percentiles, people-like-you, aspirational, top palates in area)
            now lives inline on the Wrapped tab per latest spec. */}

        <CollapsibleSection title="Your data">
          <Button title="Delete all visit history" onPress={deleteHistory} variant="ghost" />
          <Spacer />
          <Button title="Delete my account" onPress={deleteAccount} variant="danger" />
        </CollapsibleSection>

        <CollapsibleSection title="Account">
          <Button title="Blocked accounts" onPress={() => router.push("/blocked")} variant="ghost" />
          <Spacer />
          <Button title="Sign out" onPress={async () => { await signOut(); router.replace("/sign-in"); }} variant="ghost" />
        </CollapsibleSection>

        <CollapsibleSection title="Help">
          <Button
            title="Share feedback"
            onPress={() => router.push("/feedback")}
          />
          <Spacer />
          <Button
            title="Report a bug"
            variant="ghost"
            onPress={() => router.push({ pathname: "/feedback", params: { category: "bug" } })}
          />
          <Note>
            Goes straight to the team — no public post. Screenshots welcome.
          </Note>
        </CollapsibleSection>

        <CollapsibleSection title="About">
          <Button
            title="Privacy policy"
            variant="ghost"
            onPress={() => Linking.openURL("https://palate-zm29.vercel.app/privacy")}
          />
          <Spacer />
          <Button
            title="Terms of service"
            variant="ghost"
            onPress={() => Linking.openURL("https://palate-zm29.vercel.app/terms")}
          />
          <Note>
            Palate v0.1 — no ads, we don't sell your data, you control what's
            public. Questions? hello@palate.app.
          </Note>
        </CollapsibleSection>
      </ScrollView>

    </SafeAreaView>
  );
}

// Waitlist-approvals entry — renders only for admins.
function AdminEntry() {
  const router = useRouter();
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    isAdmin().then(setAdmin).catch(() => {});
  }, []);
  if (!admin) return null;
  return (
    <CollapsibleSection title="Admin">
      <Button title="Waitlist approvals" onPress={() => router.push("/admin" as never)} />
      <Note>Approve or deny people waiting to join.</Note>
      <Button title="Passive capture (debug)" onPress={() => router.push("/debug-visits" as never)} />
      <Note>Phase 1 visit detection — inject a test visit and watch the raw queue.</Note>
    </CollapsibleSection>
  );
}

// The user-facing opt-in for background visit logging. Hidden entirely while
// the remote kill switch is off, so the switch stays the single source of truth
// for whether the feature exists at all.
//
// "On" means all three gates are satisfied — opted in AND iOS Always granted.
// If iOS later downgrades the permission (it does this silently), the row drops
// to off and offers the repair rather than lying about being on.
function PassiveCaptureEntry() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [on, setOn] = useState(false);
  const [needsRepair, setNeedsRepair] = useState(false);

  const refresh = useCallback(async () => {
    const [flag, opted, always] = await Promise.all([
      isFlagEnabled(PASSIVE_CAPTURE_FLAG),
      isPassiveOptedIn(),
      hasAlways(),
    ]);
    setVisible(flag);
    setOn(opted && always);
    setNeedsRepair(opted && !always);
  }, []);

  // Re-read on focus, not just mount: the user returns here from the opt-in
  // modal and from iOS Settings, and both change the answer.
  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => {});
    }, [refresh]),
  );

  async function toggle(next: boolean) {
    if (!next) {
      setOn(false);
      setNeedsRepair(false);
      await optOutOfPassiveCapture();
      return;
    }
    // Permission already granted (re-enabling after a manual off) — no need to
    // walk the funnel again.
    if (await hasAlways()) {
      await setPassiveOptIn(true);
      await startPassiveCaptureIfEnabled();
      setOn(true);
      setNeedsRepair(false);
      return;
    }
    router.push("/passive-capture-intro" as never);
  }

  if (!visible) return null;
  return (
    <>
      <Spacer />
      <Row
        label="Log visits in the background"
        right={
          <Switch
            value={on}
            onValueChange={(v) => { void toggle(v); }}
            thumbColor={on ? colors.red : "#fff"}
            trackColor={{ true: colors.redTintBorder, false: colors.line }}
          />
        }
      />
      <Note>
        {needsRepair
          ? "Paused — iOS set location back to \"While Using.\" Switch it to Always to resume."
          : "Notices restaurant stops with the app closed, then asks. Nothing is logged until you confirm."}
      </Note>
      {needsRepair && (
        <>
          <Spacer />
          <Button title="Open iOS Settings" variant="ghost" onPress={() => Linking.openSettings()} />
        </>
      )}
    </>
  );
}

// Detected-visits inbox — a real user-facing entry, shown only once passive
// confirmation is switched on (flag), so suppressed/quiet-hours visits are
// reachable and never lost.
function PassiveInboxEntry() {
  const router = useRouter();
  const [on, setOn] = useState(false);
  useEffect(() => {
    isFlagEnabled("passive_capture_confirm").then(setOn).catch(() => {});
  }, []);
  if (!on) return null;
  return (
    <CollapsibleSection title="Detected visits">
      <Button title="Recent visits to confirm" onPress={() => router.push("/passive-inbox" as never)} />
      <Note>Stops we noticed, waiting for a quick confirm.</Note>
    </CollapsibleSection>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: spacing.xl }}>
      <Text style={type.micro}>{title}</Text>
      <Spacer size={10} />
      {children}
    </View>
  );
}

function Row({ label, right }: { label: string; right: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={type.body}>{label}</Text>
      {right}
    </View>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <Text style={[type.small, { marginTop: 8, lineHeight: 20 }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  navHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.line, borderBottomWidth: 1,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.faint,
  },
  backText: { fontSize: 18, fontWeight: "700", color: colors.ink },
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { padding: spacing.lg, paddingBottom: 100 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
  },
});
