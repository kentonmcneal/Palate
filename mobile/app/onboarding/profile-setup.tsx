import { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Button, Spacer } from "../../components/Button";
import { Avatar } from "../../components/Avatar";
import { colors, spacing, type } from "../../theme";
import { setDisplayName, uploadAvatar } from "../../lib/profile";

export default function ProfileSetup() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
    try {
      if (name.trim()) {
        await setDisplayName(name);
      }
      router.push("/onboarding/quiz");
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "Try again");
    } finally {
      setSaving(false);
    }
  }

  function skip() {
    router.push("/onboarding/quiz");
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={styles.h1}>Make it yours.</Text>
        <Spacer size={8} />
        <Text style={styles.p}>
          A name and a photo so friends can find you. Both are optional — set
          them now or later.
        </Text>

        <Spacer size={32} />

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
        <Button title={saving ? "Saving…" : "See your Starter Palate"} onPress={next} loading={saving} />
        <Spacer size={8} />
        <Pressable onPress={skip} style={styles.skipBtn}>
          <Text style={styles.skipText}>Skip for now</Text>
        </Pressable>
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
    height: 50,
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
