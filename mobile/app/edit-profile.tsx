import { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  Alert,
  Linking,
} from "react-native";
import { TextInput } from "../components/TextInput";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Button, Spacer } from "../components/Button";
import { Avatar } from "../components/Avatar";
import { colors, spacing, type } from "../theme";
import { saveSocialFields, normalizeHandle, BIO_MAX, SCHOOL_MAX } from "../lib/social";
import {
  getMyProfile, setProfileVisibility, setDisplayName, setUsername, uploadAvatar,
  type ProfileVisibility,
} from "../lib/profile";

/**
 * Everything that changes what your profile SAYS, in one place.
 *
 * These fields used to be scattered down the Settings screen between push
 * toggles and account deletion, which is why the People directory was full of
 * blank bios: the form existed but nobody scrolled far enough to find it. It is
 * now one tap from the profile it edits.
 *
 * Visibility lives here too, for the same reason — "who can see this" is a
 * property of the profile, not a device preference.
 */
export default function EditProfileScreen() {
  const router = useRouter();

  const [displayName, setDisplayNameState] = useState<string | null>(null);
  const [username, setUsernameState] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bio, setBio] = useState("");
  const [school, setSchool] = useState("");
  const [ig, setIg] = useState("");
  const [tt, setTt] = useState("");
  const [savingSocial, setSavingSocial] = useState(false);
  const [socialSaved, setSocialSaved] = useState(false);

  const [visibility, setVisibility] = useState<ProfileVisibility>("friends");

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [editingUsername, setEditingUsername] = useState(false);
  const [draftUsername, setDraftUsername] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);

  useEffect(() => {
    getMyProfile().then((p) => {
      if (!p) return;
      setVisibility(p.profile_visibility);
      setDisplayNameState(p.display_name);
      setEmail(p.email ?? null);
      setFirstName((p as { first_name?: string | null }).first_name ?? "");
      setLastName((p as { last_name?: string | null }).last_name ?? "");
      setBio((p as { bio?: string | null }).bio ?? "");
      setSchool((p as { school?: string | null }).school ?? "");
      setIg((p as { instagram_handle?: string | null }).instagram_handle ?? "");
      setTt((p as { tiktok_handle?: string | null }).tiktok_handle ?? "");
      setUsernameState(p.username);
      setAvatarUrl(p.avatar_url);
    }).catch(() => {});
  }, []);

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Photo access off",
        "Allow photo library access in Settings → Palate to choose a profile photo.",
        [
          { text: "Open Settings", onPress: () => Linking.openSettings() },
          { text: "Not now" },
        ],
      );
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

  async function saveName() {
    setEditingName(false);
    try {
      await setDisplayName(draftName);
      setDisplayNameState(draftName.trim() || null);
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message ?? "Try again");
    }
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
    const prev = visibility;
    setVisibility(next); // optimistic
    try {
      await setProfileVisibility(next);
    } catch (e: any) {
      // Roll back so the UI never shows a privacy setting the DB didn't save.
      setVisibility(prev);
      Alert.alert("Couldn't update", e.message ?? "Try again");
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.navHeader}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button">
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={type.title}>Edit profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Identity */}
        <View style={styles.headCard}>
          <Pressable onPress={pickAvatar} accessibilityLabel="Change profile photo">
            <Avatar uri={avatarUrl} name={displayName} email={email} size={64} />
            <View style={styles.avatarBadge}>
              <Text style={styles.avatarBadgeText}>{uploadingAvatar ? "…" : avatarUrl ? "✎" : "+"}</Text>
            </View>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={type.title}>{displayName || "You"}</Text>
            <Pressable onPress={() => { setDraftUsername(username ?? ""); setUsernameError(null); setEditingUsername(true); }}>
              <Text style={[type.small, { marginTop: 2, color: username ? colors.red : colors.mute, fontWeight: "700" }]}>
                {username ? `@${username}` : "Set a username"}
              </Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() => { setDraftName(displayName ?? ""); setEditingName(true); }}
            style={styles.editName}
          >
            <Text style={styles.editNameText}>{displayName ? "Edit name" : "Set name"}</Text>
          </Pressable>
        </View>

        <Section title="Your profile">
          <Note>Shown to anyone who can see your profile.</Note>
          <Spacer size={10} />
          <Text style={styles.fieldLabel}>First name</Text>
          <TextInput
            value={firstName}
            onChangeText={(v) => { setFirstName(v.slice(0, 40)); setSocialSaved(false); }}
            placeholder="First"
            placeholderTextColor={colors.mute}
            style={styles.input}
            autoCapitalize="words"
            maxLength={40}
          />

          <Text style={styles.fieldLabel}>Last name</Text>
          <TextInput
            value={lastName}
            onChangeText={(v) => { setLastName(v.slice(0, 40)); setSocialSaved(false); }}
            placeholder="Last"
            placeholderTextColor={colors.mute}
            style={styles.input}
            autoCapitalize="words"
            maxLength={40}
          />

          <Text style={styles.fieldLabel}>Bio</Text>
          <TextInput
            value={bio}
            onChangeText={(v) => { setBio(v.slice(0, BIO_MAX)); setSocialSaved(false); }}
            placeholder="One line about how you eat"
            placeholderTextColor={colors.mute}
            style={[styles.input, styles.inputMultiline]}
            multiline
            maxLength={BIO_MAX}
          />
          <Text style={styles.counter}>{bio.length}/{BIO_MAX}</Text>

          <Text style={styles.fieldLabel}>School</Text>
          <TextInput
            value={school}
            onChangeText={(v) => { setSchool(v.slice(0, SCHOOL_MAX)); setSocialSaved(false); }}
            placeholder="Optional"
            placeholderTextColor={colors.mute}
            style={styles.input}
            maxLength={SCHOOL_MAX}
          />

          <Text style={styles.fieldLabel}>Instagram</Text>
          <TextInput
            value={ig}
            onChangeText={(v) => { setIg(v); setSocialSaved(false); }}
            placeholder="@handle or link"
            placeholderTextColor={colors.mute}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Note>Opens the Instagram app from your profile when someone taps it.</Note>

          <Text style={styles.fieldLabel}>TikTok</Text>
          <TextInput
            value={tt}
            onChangeText={(v) => { setTt(v); setSocialSaved(false); }}
            placeholder="@handle or link"
            placeholderTextColor={colors.mute}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Spacer size={12} />
          <Button
            title={savingSocial ? "Saving…" : socialSaved ? "Saved ✓" : "Save profile"}
            onPress={async () => {
              setSavingSocial(true);
              try {
                await saveSocialFields({ firstName, lastName, bio, school, instagram: ig, tiktok: tt });
                // Echo back what was actually stored: a pasted URL becomes a
                // bare handle, and anything unusable becomes empty, so the
                // field should stop showing text that was not saved.
                setIg(normalizeHandle(ig) ?? "");
                setTt(normalizeHandle(tt) ?? "");
                setSocialSaved(true);
              } catch (e: any) {
                Alert.alert("Couldn't save", e?.message ?? "Try again.");
              } finally {
                setSavingSocial(false);
              }
            }}
          />
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
          <Spacer />
          <Button
            title="Choose what friends see"
            variant="ghost"
            onPress={() => router.push("/curate-profile" as never)}
          />
          <Note>
            Your history stays complete either way — this only controls which visits
            appear on your profile.
          </Note>
          <Spacer />
          <Note>
            {visibility === "public" && "Anyone on Palate can see your profile and persona."}
            {visibility === "friends" && "Only your accepted friends can see your profile and persona."}
            {visibility === "private" && "Nothing is visible to anyone but you."}
          </Note>
        </Section>

        <Section title="About you">
          <Button
            title="Demographics & background"
            onPress={() => router.push("/demographics")}
            variant="ghost"
          />
          <Note>
            Optional. Powers "Top Palates in your demographic". Never sold,
            never shown publicly.
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
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { padding: spacing.lg, paddingBottom: 100 },
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

  headCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    padding: spacing.md,
    borderRadius: 22,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  avatarBadge: {
    position: "absolute", right: -2, bottom: -2,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.red,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.paper,
  },
  avatarBadgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  editName: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line,
  },
  editNameText: { fontSize: 12, fontWeight: "700", color: colors.ink },

  section: { marginTop: spacing.xl },
  sectionTitle: { ...type.subtitle, marginBottom: 10 },
  note: { ...type.small, marginTop: 8, lineHeight: 19 },

  fieldLabel: { ...type.micro, marginTop: 14, marginBottom: 6 },
  input: {
    minHeight: 46, paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 12, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.faint, color: colors.ink, fontSize: 15,
  },
  inputMultiline: { minHeight: 68, textAlignVertical: "top" },
  counter: { ...type.small, textAlign: "right", marginTop: 4 },

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
});
