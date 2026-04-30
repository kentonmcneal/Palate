import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Switch, Alert, Linking, ScrollView, Share, Pressable, Modal, TextInput } from "react-native";
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
import { loadAnalytics, type AnalyticsSummary } from "../../lib/analytics-stats";
import { getMyProfile, setProfileVisibility, setDisplayName, type ProfileVisibility } from "../../lib/profile";
import { listIncomingRequests } from "../../lib/friends";

const CUISINE_LABELS: Record<string, string> = {
  italian: "Italian", mexican: "Mexican", japanese: "Japanese", chinese: "Chinese",
  thai: "Thai", indian: "Indian", vietnamese: "Vietnamese", korean: "Korean",
  mediterranean: "Mediterranean", "middle-eastern": "Middle Eastern",
  american: "American", bbq: "BBQ", seafood: "Seafood", steakhouse: "Steakhouse",
  bakery: "Bakery", dessert: "Dessert", "café": "Café", healthy: "Healthy",
  bar: "Bar", other: "Other",
};

const PAUSE_KEY = "palate.tracking.paused";

export default function Settings() {
  const router = useRouter();
  const [tracking, setTracking] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [sundayReminder, setSundayReminder] = useState(false);
  const [stats, setStats] = useState<AnalyticsSummary | null>(null);
  const [visibility, setVisibility] = useState<ProfileVisibility>("friends");
  const [displayName, setDisplayNameState] = useState<string | null>(null);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");

  useEffect(() => {
    AsyncStorage.getItem(PAUSE_KEY).then((v) => setTracking(v !== "1"));
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    isReminderEnabled().then(setSundayReminder);
    loadAnalytics("all").then(setStats).catch(() => {});
    getMyProfile().then((p) => {
      if (!p) return;
      setVisibility(p.profile_visibility);
      setDisplayNameState(p.display_name);
    }).catch(() => {});
    listIncomingRequests().then((rs) => setPendingRequestCount(rs.length)).catch(() => {});
  }, []);

  function openNameEditor() {
    setDraftName(displayName ?? "");
    setEditingName(true);
  }

  async function saveName() {
    setEditingName(false);
    try {
      await setDisplayName(draftName);
      setDisplayNameState(draftName.trim() || null);
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message ?? "Try again");
    }
  }

  async function changeVisibility(next: ProfileVisibility) {
    setVisibility(next); // optimistic
    try {
      await setProfileVisibility(next);
    } catch (e: any) {
      Alert.alert("Couldn't update", e.message ?? "Try again");
    }
  }

  async function inviteFriends() {
    try {
      await Share.share({
        title: "Palate",
        message:
          "I've been using this app called Palate — it tells you what your eating habits actually say about you. Patterns, not ratings. You can see how your friends actually eat too. You should try it: https://palate.app",
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
        {/* Profile snapshot */}
        <View style={styles.profileCard}>
          <View style={styles.profileHead}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {email ? email[0].toUpperCase() : "•"}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={type.title}>{displayName || "You"}</Text>
              {email && (
                <Text style={[type.small, { marginTop: 2 }]} numberOfLines={1}>
                  {email}
                </Text>
              )}
            </View>
            <Pressable onPress={openNameEditor} style={styles.editName}>
              <Text style={styles.editNameText}>{displayName ? "Edit name" : "Set name"}</Text>
            </Pressable>
          </View>

          {stats && stats.totalVisits > 0 && (
            <>
              {stats.topSpots.length > 0 && (
                <View style={styles.profileBlock}>
                  <Text style={styles.profileLabel}>YOUR TOP 3 SPOTS</Text>
                  {stats.topSpots.slice(0, 3).map((s, i) => (
                    <View key={s.name} style={styles.profileRow}>
                      <Text style={styles.profileRank}>{i + 1}</Text>
                      <Text style={styles.profileName} numberOfLines={1}>{s.name}</Text>
                      <Text style={styles.profileCount}>×{s.count}</Text>
                    </View>
                  ))}
                </View>
              )}
              {stats.cuisineBreakdown.length > 0 && (
                <View style={styles.profileBlock}>
                  <Text style={styles.profileLabel}>YOUR TOP 3 CUISINES</Text>
                  <View style={styles.cuisineRow}>
                    {stats.cuisineBreakdown.slice(0, 3).map((c) => (
                      <View key={c.cuisine} style={styles.cuisineChip}>
                        <Text style={styles.cuisineChipText}>
                          {CUISINE_LABELS[c.cuisine] ?? c.cuisine}
                        </Text>
                        <Text style={styles.cuisineChipPct}>
                          {Math.round(c.pct * 100)}%
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </>
          )}

          {(!stats || stats.totalVisits === 0) && (
            <Text style={[type.small, { marginTop: 12, lineHeight: 20 }]}>
              Your top spots and cuisines will appear here once you've logged
              a few visits.
            </Text>
          )}

          <Pressable
            onPress={() => router.push("/insights")}
            style={styles.profileLink}
            accessibilityRole="button"
          >
            <Text style={styles.profileLinkText}>See full insights →</Text>
          </Pressable>
        </View>

        <Section title="Friends">
          <Button
            title={`Manage friends${pendingRequestCount > 0 ? ` · ${pendingRequestCount} request${pendingRequestCount === 1 ? "" : "s"}` : ""}`}
            onPress={() => router.push("/friends")}
          />
          <Spacer />
          <Button title="Share Palate with someone" onPress={inviteFriends} variant="ghost" />
          <Note>
            Manage friend requests + add friends by email. Or share Palate via
            iMessage / WhatsApp from the share sheet.
          </Note>
        </Section>

        <Section title="Try List">
          <Button
            title="View places you've saved"
            onPress={() => router.push("/(tabs)/wishlist")}
            variant="ghost"
          />
          <Note>Spots you've saved from your weekly Palate insights.</Note>
        </Section>

        <Section title="Profile visibility">
          <View style={styles.visRow}>
            {(["public", "friends", "private"] as ProfileVisibility[]).map((v) => (
              <Pressable
                key={v}
                onPress={() => changeVisibility(v)}
                style={[styles.visBtn, visibility === v && styles.visBtnActive]}
              >
                <Text style={[styles.visText, visibility === v && styles.visTextActive]}>
                  {v[0].toUpperCase() + v.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Note>
            {visibility === "public" && "Anyone on Palate can see your profile and persona."}
            {visibility === "friends" && "Only your accepted friends can see your profile and persona."}
            {visibility === "private" && "Nothing is visible to anyone but you."}
          </Note>
        </Section>

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
          <Note>Palate v0.1 — no ads, we don't sell your data, you control what's public.</Note>
        </Section>
      </ScrollView>

      {/* Display name editor */}
      <Modal visible={editingName} transparent animationType="fade" onRequestClose={() => setEditingName(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Your display name</Text>
            <Text style={styles.modalBody}>How your friends will see you in the feed.</Text>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder="Kenton M."
              placeholderTextColor={colors.mute}
              maxLength={30}
              autoFocus
              style={styles.modalInput}
              returnKeyType="done"
              onSubmitEditing={saveName}
            />
            <View style={styles.modalRow}>
              <Pressable onPress={() => setEditingName(false)} style={styles.modalCancel}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveName} style={styles.modalSave}>
                <Text style={styles.modalSaveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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

  // Profile card
  profileCard: {
    padding: spacing.md,
    borderRadius: 22,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  profileHead: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.red,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 22, fontWeight: "800" },
  profileBlock: {
    marginTop: 18,
    paddingTop: 14,
    borderTopColor: colors.line, borderTopWidth: 1,
  },
  profileLabel: { ...type.micro, marginBottom: 8 },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: 12,
  },
  profileRank: { ...type.small, fontWeight: "800", color: colors.mute, width: 16 },
  profileName: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.ink },
  profileCount: { fontSize: 14, fontWeight: "700", color: colors.red },
  cuisineRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cuisineChip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.line,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  cuisineChipText: { fontSize: 13, fontWeight: "700", color: colors.ink },
  cuisineChipPct: { fontSize: 12, fontWeight: "700", color: colors.red },
  profileLink: {
    marginTop: 14,
    paddingTop: 12,
    borderTopColor: colors.line, borderTopWidth: 1,
    alignItems: "flex-start",
  },
  profileLinkText: { fontSize: 13, fontWeight: "700", color: colors.red },

  // Visibility selector
  visRow: { flexDirection: "row", gap: 8 },
  visBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
    alignItems: "center",
  },
  visBtnActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  visText: { fontSize: 13, fontWeight: "700", color: colors.mute },
  visTextActive: { color: "#fff" },

  // Edit name pill
  editName: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line,
  },
  editNameText: { fontSize: 12, fontWeight: "700", color: colors.ink },

  // Display name modal
  modalScrim: {
    flex: 1, backgroundColor: "rgba(15,15,15,0.55)",
    alignItems: "center", justifyContent: "center", padding: spacing.lg,
  },
  modalCard: {
    width: "100%", maxWidth: 360,
    backgroundColor: colors.paper, borderRadius: 22, padding: spacing.lg,
  },
  modalTitle: { fontSize: 22, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 },
  modalBody: { ...type.small, marginTop: 6, lineHeight: 20 },
  modalInput: {
    marginTop: 18, height: 50, borderRadius: 14,
    borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 16, fontSize: 17, color: colors.ink,
  },
  modalRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  modalCancel: {
    flex: 1, paddingVertical: 12, borderRadius: 14,
    backgroundColor: colors.faint, alignItems: "center",
  },
  modalCancelText: { fontSize: 14, fontWeight: "700", color: colors.mute },
  modalSave: {
    flex: 1, paddingVertical: 12, borderRadius: 14,
    backgroundColor: colors.red, alignItems: "center",
  },
  modalSaveText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
  },
});
