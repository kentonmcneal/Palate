import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Switch, Alert, Linking, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { supabase } from "../../lib/supabase";
import { signOut } from "../../lib/auth";
import { generateForCurrentWeek } from "../../lib/wrapped";
import {
  isReminderEnabled,
  enableSundayWrappedReminder,
  disableSundayWrappedReminder,
} from "../../lib/notifications";

const PAUSE_KEY = "palate.tracking.paused";

export default function Settings() {
  const router = useRouter();
  const [tracking, setTracking] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [sundayReminder, setSundayReminder] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(PAUSE_KEY).then((v) => setTracking(v !== "1"));
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    isReminderEnabled().then(setSundayReminder);
  }, []);

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
    await AsyncStorage.setItem(PAUSE_KEY, next ? "0" : "1");
    if (next) {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("System permission off", "Open iOS Settings to allow location.", [
          { text: "Open Settings", onPress: () => Linking.openSettings() },
          { text: "Not now" },
        ]);
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
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={type.title}>Settings</Text>
        {email && <Text style={[type.small, { marginTop: 4 }]}>Signed in as {email}</Text>}

        <Section title="Privacy">
          <Row label="Location tracking" right={<Switch value={tracking} onValueChange={toggleTracking} thumbColor={tracking ? colors.red : "#fff"} trackColor={{ true: "#FFCFC5", false: colors.line }} />} />
          <Note>
            When off, Palate stops checking your location. Past visits stay. You can still
            add visits manually.
          </Note>
        </Section>

        <Section title="Notifications">
          <Row label="Sunday Wrapped reminder" right={<Switch value={sundayReminder} onValueChange={toggleSundayReminder} thumbColor={sundayReminder ? colors.red : "#fff"} trackColor={{ true: "#FFCFC5", false: colors.line }} />} />
          <Note>One reminder a week, Sunday at 9 AM. That's it.</Note>
        </Section>

        <Section title="Wrapped">
          <Button title="Generate this week's Wrapped" onPress={manualGenerate} variant="ghost" />
          <Spacer />
          <Button
            title="View detailed Insights"
            onPress={() => router.push("/insights")}
            variant="ghost"
          />
          <Spacer />
          <Button
            title="Preview Year in Palate (December)"
            onPress={() => router.push("/year-in-review")}
            variant="ghost"
          />
        </Section>

        <Section title="Your data">
          <Button title="Delete all visit history" onPress={deleteHistory} variant="ghost" />
          <Spacer />
          <Button title="Delete my account" onPress={deleteAccount} variant="danger" />
        </Section>

        <Section title="Account">
          <Button title="Sign out" onPress={async () => { await signOut(); router.replace("/sign-in"); }} variant="ghost" />
        </Section>

        <Section title="About">
          <Note>Palate v0.1 — built for you, no ads, no selling, no social anything.</Note>
        </Section>
      </ScrollView>
    </SafeAreaView>
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
