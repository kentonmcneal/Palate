import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Button, Spacer } from "../../components/Button";
import { Avatar } from "../../components/Avatar";
import { colors, spacing, type } from "../../theme";
import { setDisplayName, uploadAvatar, setUsername, getMyProfile } from "../../lib/profile";
import { UsernameField } from "../../components/UsernameField";
import { validateUsername, suggestUsername } from "../../lib/username";
import { markUsernameClaimed } from "../../lib/username-gate";
import { track } from "../../lib/analytics";

export default function ProfileSetup() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleError, setHandleError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Offer a handle rather than an empty box. Most people take a reasonable
  // suggestion, and anyone who cares about theirs was going to type it anyway.
  useEffect(() => {
    void getMyProfile()
      .then((p) => {
        if (!p) return;
        setHandle((h) => h || suggestUsername(p.email, p.display_name));
      })
      .catch(() => {});
  }, []);

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Photo access off", "Allow photo library access in Settings → Palate.", [
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
    setUploading(true);
    try {
      const url = await uploadAvatar(result.assets[0].uri);
      setAvatarUrl(url);
    } catch (e: any) {
      Alert.alert("Couldn't upload", e?.message ?? "Try again");
    } finally {
      setUploading(false);
    }
  }

  async function next() {
    // Username is the one thing this screen will not let you past. Everything
    // downstream — the feed, profiles, search — identifies people by it now
    // that email is no longer shown, and an account without one is a stranger
    // to everybody including its owner.
    const check = validateUsername(handle);
    if (!check.ok) {
      setHandleError(check.message);
      return;
    }

    setSaving(true);
    setHandleError(null);
    try {
      const claimed = await setUsername(check.value);
      if (!claimed.ok) {
        setHandleError(
          claimed.reason === "taken"
            ? `@${check.value} is taken. Try another.`
            : "Couldn't save that handle. Try again.",
        );
        return;
      }
      markUsernameClaimed();
      if (name.trim()) {
        await setDisplayName(name);
      }
      void track("profile_setup_completed", {
        had_name: !!name.trim(),
        had_photo: !!avatarUrl,
        had_username: true,
      });
      router.push("/onboarding/quiz");
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "Try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={styles.h1}>Make it yours.</Text>
        <Spacer size={8} />
        <Text style={styles.p}>
          Pick a handle so friends can find you. A name and a photo are
          optional — set those now or later.
        </Text>

        <Spacer size={28} />

        <UsernameField
          value={handle}
          onChange={(v) => { setHandle(v); setHandleError(null); }}
          error={handleError}
        />

        <Spacer size={24} />

        <View style={styles.avatarRow}>
          <Pressable onPress={pickPhoto} accessibilityLabel="Choose photo">
            <Avatar uri={avatarUrl} name={name} size={96} />
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{uploading ? "…" : avatarUrl ? "✎" : "+"}</Text>
            </View>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Display name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Kenton M."
              placeholderTextColor={colors.mute}
              maxLength={30}
              style={styles.input}
              returnKeyType="next"
              onSubmitEditing={next}
            />
          </View>
        </View>

        <Spacer size={12} />
        <Text style={styles.helper}>
          Tap the photo to upload one. We never share your photo with anyone outside
          your friends.
        </Text>
      </View>

      <View style={styles.cta}>
        {/* No "Skip for now". The handle is required, so offering a way past
            it would either be a lie or leave accounts nobody can refer to. */}
        <Button title={saving ? "Saving…" : "See your Starter Palate"} onPress={next} loading={saving} />
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
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 18 },
  badge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.ink,
    borderWidth: 2,
    borderColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  label: { ...type.micro, marginBottom: 6 },
  input: {
    minHeight: 50, paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    fontSize: 17,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  helper: { ...type.small, lineHeight: 20 },
  skipBtn: { alignItems: "center", paddingVertical: 8 },
  skipText: { color: colors.mute, fontSize: 13, fontWeight: "600" },
});
