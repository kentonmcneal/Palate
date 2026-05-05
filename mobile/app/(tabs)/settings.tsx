import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Switch, Alert, Linking, ScrollView, Share, Pressable, Modal, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Button, Spacer } from "../../components/Button";
import { Avatar } from "../../components/Avatar";
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
import { computeTasteVector } from "../../lib/taste-vector";
import { generateIdentitySet, type PalateIdentitySet } from "../../lib/palate-labels";
import { getMyProfile, setProfileVisibility, setDisplayName, setUsername, uploadAvatar, type ProfileVisibility } from "../../lib/profile";
import { listIncomingRequests } from "../../lib/friends";
import { generateInviteLink, inviteShareMessage, getMyReferralCount } from "../../lib/referrals";
import { GmailImportCard } from "../../components/GmailImportCard";
import { SavedNearbyCard } from "../../components/SavedNearbyCard";

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
  const [identitySet, setIdentitySet] = useState<PalateIdentitySet | null>(null);
  const [visibility, setVisibility] = useState<ProfileVisibility>("friends");
  const [displayName, setDisplayNameState] = useState<string | null>(null);
  const [username, setUsernameState] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [referralCount, setReferralCount] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [editingUsername, setEditingUsername] = useState(false);
  const [draftUsername, setDraftUsername] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(PAUSE_KEY).then((v) => setTracking(v !== "1"));
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    isReminderEnabled().then(setSundayReminder);
    loadAnalytics("all").then(setStats).catch(() => {});
    // Compute the user's overall (all-time) palate identity for the Profile.
    computeTasteVector().then((v) => {
      if (v && v.visitCount > 0) setIdentitySet(generateIdentitySet(v));
    }).catch(() => {});
    getMyProfile().then((p) => {
      if (!p) return;
      setVisibility(p.profile_visibility);
      setDisplayNameState(p.display_name);
      setUsernameState(p.username);
      setAvatarUrl(p.avatar_url);
    }).catch(() => {});
    listIncomingRequests().then((rs) => setPendingRequestCount(rs.length)).catch(() => {});
    getMyReferralCount().then(setReferralCount).catch(() => {});
  }, []);

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Photo access off", "Allow photo library access in Settings → Palate to choose a profile photo.", [
        { text: "Open Settings", onPress: () => Linking.openSettings() },
        { text: "Not now" },
      ]);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    setUploadingAvatar(true);
    try {
      const url = await uploadAvatar(result.assets[0].uri);
      setAvatarUrl(url);
    } catch (e: any) {
      Alert.alert("Couldn't upload", e?.message ?? "Try again");
    } finally {
      setUploadingAvatar(false);
    }
  }

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

  function openUsernameEditor() {
    setDraftUsername(username ?? "");
    setUsernameError(null);
    setEditingUsername(true);
  }

  async function saveUsernameHandle() {
    const result = await setUsername(draftUsername);
    if (!result.ok) {
      if (result.reason === "taken") setUsernameError("That handle is taken.");
      else if (result.reason === "invalid") setUsernameError("3-20 chars, letters/numbers/underscores only.");
      else setUsernameError("Couldn't save. Try again.");
      return;
    }
    setUsernameState(draftUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, ""));
    setUsernameError(null);
    setEditingUsername(false);
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
            <Pressable onPress={pickAvatar} accessibilityLabel="Change profile photo">
              <Avatar uri={avatarUrl} name={displayName} email={email} size={64} />
              <View style={styles.avatarBadge}>
                <Text style={styles.avatarBadgeText}>{uploadingAvatar ? "…" : avatarUrl ? "✎" : "+"}</Text>
              </View>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={type.title}>{displayName || "You"}</Text>
              <Pressable onPress={openUsernameEditor}>
                <Text style={[type.small, { marginTop: 2, color: username ? colors.red : colors.mute, fontWeight: "700" }]}>
                  {username ? `@${username}` : "Set a username"}
                </Text>
              </Pressable>
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

          {/* Overall palate identity — promoted to the top of the Profile card.
              Tap to dive into deep insights. */}
          {identitySet && (
            <Pressable
              onPress={() => router.push("/insights-deep")}
              style={styles.identityBlock}
              accessibilityRole="button"
            >
              <Text style={styles.identityEyebrow}>YOUR PALATE</Text>
              <Text style={styles.identityName}>{identitySet.primary.label}</Text>
              <Text style={styles.identityDesc}>{identitySet.primary.description}</Text>
            </Pressable>
          )}

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

        {/* Saved restaurants moved here from Home — Profile is the right place
            for "things I've kept." */}
        <SavedNearbyCard />

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

        <Section title="Next Moves">
          <Button
            title="View places you've saved"
            onPress={() => router.push("/(tabs)/wishlist")}
            variant="ghost"
          />
          <Note>Spots worth a visit. We'll surface them on Home when you're nearby.</Note>
        </Section>

        <Section title="Photos">
          <Button
            title="Your meal photos"
            onPress={() => router.push("/photos")}
            variant="ghost"
          />
          <Note>Every photo you've added to a visit, in one grid.</Note>
        </Section>

        <Section title="About you">
          <Button
            title="Demographics & background"
            onPress={() => router.push("/demographics")}
            variant="ghost"
          />
          <Note>
            Optional. Powers "Top Palates in your demographic" — never sold,
            never shown publicly.
          </Note>
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

        <Section title="Passive tracking">
          <Row label="Auto-detect visits" right={<Switch value={tracking} onValueChange={toggleTracking} thumbColor={tracking ? colors.red : "#fff"} trackColor={{ true: "#FFCFC5", false: colors.line }} />} />
          <Note>
            When on, Palate checks your location whenever the app opens and prompts you
            to confirm if you're at a restaurant. Removes the friction of remembering to
            log every visit. Past visits stay if you turn this off.
          </Note>
        </Section>

        <Section title="Notifications">
          <Row label="Sunday Wrapped reminder" right={<Switch value={sundayReminder} onValueChange={toggleSundayReminder} thumbColor={sundayReminder ? colors.red : "#fff"} trackColor={{ true: "#FFCFC5", false: colors.line }} />} />
          <Note>One reminder a week, Sunday at 9 AM. That's it.</Note>
        </Section>

        <Section title="Your Wrapped">
          <Button title="Open this week's Wrapped" onPress={() => router.push("/(tabs)/wrapped")} />
          <Note>One-glance reflection: identity, three stats, one insight.</Note>
          <Spacer />
          <Button title="Generate this week's Wrapped" onPress={manualGenerate} variant="ghost" />
          <Spacer />
          <Button
            title="Preview Year in Palate (December)"
            onPress={() => router.push("/year-in-review")}
            variant="ghost"
          />
        </Section>

        {/* Insights section removed — all of that content (Palate Lore,
            percentiles, people-like-you, aspirational, top palates in area)
            now lives inline on the Wrapped tab per latest spec. */}

        <Section title="Your data">
          <Button title="Delete all visit history" onPress={deleteHistory} variant="ghost" />
          <Spacer />
          <Button title="Delete my account" onPress={deleteAccount} variant="danger" />
        </Section>

        <Section title="Account">
          <Button title="Sign out" onPress={async () => { await signOut(); router.replace("/sign-in"); }} variant="ghost" />
        </Section>

        <Section title="Help">
          <Button
            title="Send feedback"
            variant="ghost"
            onPress={() => Linking.openURL("mailto:hello@palate.app?subject=Palate%20feedback").catch(() => {
              Alert.alert("No email app", "Email us at hello@palate.app");
            })}
          />
          <Spacer />
          <Button
            title="Report a bug"
            variant="ghost"
            onPress={() => Linking.openURL("mailto:hello@palate.app?subject=Palate%20bug%20report").catch(() => {
              Alert.alert("No email app", "Email us at hello@palate.app");
            })}
          />
        </Section>

        <Section title="About">
          <Button
            title="Privacy policy"
            variant="ghost"
            onPress={() => Linking.openURL("https://palate.app/privacy")}
          />
          <Spacer />
          <Button
            title="Terms of service"
            variant="ghost"
            onPress={() => Linking.openURL("https://palate.app/terms")}
          />
          <Note>
            Palate v0.1 — no ads, we don't sell your data, you control what's
            public. Questions? hello@palate.app.
          </Note>
        </Section>
      </ScrollView>

      {/* Username editor */}
      <Modal visible={editingUsername} transparent animationType="fade" onRequestClose={() => setEditingUsername(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Your username</Text>
            <Text style={styles.modalBody}>
              Friends can find you by @handle. Letters, numbers, underscores only. 3-20 characters.
            </Text>
            <TextInput
              value={draftUsername}
              onChangeText={(t) => { setDraftUsername(t); setUsernameError(null); }}
              placeholder="kenton"
              placeholderTextColor={colors.mute}
              maxLength={20}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              style={styles.modalInput}
              returnKeyType="done"
              onSubmitEditing={saveUsernameHandle}
            />
            {usernameError && (
              <Text style={{ color: colors.red, fontSize: 12, marginTop: 6, fontWeight: "600" }}>
                {usernameError}
              </Text>
            )}
            <View style={styles.modalRow}>
              <Pressable onPress={() => setEditingUsername(false)} style={styles.modalCancel}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveUsernameHandle} style={styles.modalSave}>
                <Text style={styles.modalSaveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
  avatarBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.ink,
    borderWidth: 2,
    borderColor: colors.faint,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarBadgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  identityBlock: {
    marginTop: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.ink,
  },
  identityEyebrow: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  identityName: { color: colors.red, fontSize: 24, fontWeight: "800", letterSpacing: -0.5, marginTop: 4 },
  identityDesc: { color: "rgba(255,255,255,0.78)", fontSize: 13, lineHeight: 18, marginTop: 6, fontWeight: "500" },
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
