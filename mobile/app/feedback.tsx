import { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, ScrollView, Pressable, Alert,
  KeyboardAvoidingView, Platform, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Button, Spacer } from "../components/Button";
import { colors, spacing, type, radius } from "../theme";
import { submitFeedback, FEEDBACK_CATEGORIES, type FeedbackCategory } from "../lib/feedback";

export default function Feedback() {
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string }>();
  const initial = FEEDBACK_CATEGORIES.find((c) => c.key === params.category)?.key ?? "bug";

  const [category, setCategory] = useState<FeedbackCategory>(initial);
  const [message, setMessage] = useState("");
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function attachScreenshot() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!res.canceled && res.assets[0]) setScreenshotUri(res.assets[0].uri);
  }

  async function send() {
    if (!message.trim()) {
      Alert.alert("One sec", "Add a little detail so we can act on it.");
      return;
    }
    setSubmitting(true);
    try {
      await submitFeedback({ category, message, screenshotUri, route: "settings" });
      setDone(true);
    } catch (e: any) {
      Alert.alert("Couldn't send", e?.message ?? "Please try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.doneWrap}>
          <Text style={styles.doneEmoji}>🙏</Text>
          <Text style={[type.title, { textAlign: "center" }]}>Got it — thank you</Text>
          <Text style={[type.small, { textAlign: "center", marginTop: 8, lineHeight: 20 }]}>
            This goes straight to us. Early feedback shapes what Palate becomes.
          </Text>
          <Spacer size={24} />
          <Button title="Done" onPress={() => router.back()} />
          <Spacer />
          <Button
            title="Send another"
            variant="ghost"
            onPress={() => { setMessage(""); setScreenshotUri(null); setDone(false); }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={type.title}>Share feedback</Text>
          <Text style={[type.small, { marginTop: 6, lineHeight: 20 }]}>
            Bugs, ideas, anything confusing. It comes straight to the team — no public post.
          </Text>

          <Text style={[type.micro, { marginTop: spacing.xl }]}>What kind?</Text>
          <Spacer size={10} />
          <View style={styles.chips}>
            {FEEDBACK_CATEGORIES.map((c) => {
              const active = c.key === category;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => setCategory(c.key)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {c.emoji}  {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[type.micro, { marginTop: spacing.xl }]}>Details</Text>
          <Spacer size={10} />
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="What happened, or what would make this better?"
            placeholderTextColor={colors.mute}
            multiline
            style={styles.input}
            textAlignVertical="top"
          />

          <Spacer size={20} />
          {screenshotUri ? (
            <View style={styles.shotRow}>
              <Image source={{ uri: screenshotUri }} style={styles.shotThumb} />
              <Pressable onPress={() => setScreenshotUri(null)} hitSlop={8}>
                <Text style={[type.small, { color: colors.redText, fontWeight: "600" }]}>Remove</Text>
              </Pressable>
            </View>
          ) : (
            <Button title="Attach a screenshot (optional)" variant="ghost" onPress={attachScreenshot} />
          )}

          <Spacer size={28} />
          <Button title="Send feedback" onPress={send} loading={submitting} />
          <Text style={[type.small, { marginTop: 12, lineHeight: 18 }]}>
            We attach your app version and device automatically so we can reproduce issues.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  back: { ...type.body, color: colors.mute, fontWeight: "600" },
  container: { padding: spacing.lg, paddingBottom: 60 },

  chips: { gap: 10 },
  chip: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  chipActive: { borderColor: colors.redTintBorder, backgroundColor: colors.redTint },
  chipText: { ...type.body, color: colors.ink },
  chipTextActive: { color: colors.ink, fontWeight: "700" },

  input: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: 14,
    ...type.body,
    color: colors.ink,
    backgroundColor: colors.paper,
  },

  shotRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  shotThumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.faint },

  doneWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  doneEmoji: { fontSize: 44, marginBottom: 12 },
});
