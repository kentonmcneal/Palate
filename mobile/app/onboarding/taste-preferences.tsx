import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { saveTastePreferences } from "../../lib/profile";
import { track } from "../../lib/analytics";

const CUISINES: Array<{ key: string; emoji: string; label: string }> = [
  { key: "italian",        emoji: "🍕", label: "Italian / pizza" },
  { key: "mexican",        emoji: "🌮", label: "Mexican" },
  { key: "japanese",       emoji: "🍣", label: "Japanese / sushi" },
  { key: "chinese",        emoji: "🥡", label: "Chinese" },
  { key: "thai",           emoji: "🌶️", label: "Thai" },
  { key: "indian",         emoji: "🍛", label: "Indian" },
  { key: "vietnamese",     emoji: "🍜", label: "Vietnamese" },
  { key: "korean",         emoji: "🥢", label: "Korean" },
  { key: "mediterranean",  emoji: "🥙", label: "Mediterranean" },
  { key: "american",       emoji: "🍔", label: "American comfort" },
  { key: "bbq",            emoji: "🍖", label: "BBQ" },
  { key: "healthy",        emoji: "🥗", label: "Healthy / bowls" },
  { key: "café",           emoji: "☕", label: "Café / coffee" },
  { key: "bakery",         emoji: "🥐", label: "Bakery / sweets" },
  { key: "seafood",        emoji: "🦞", label: "Seafood" },
  { key: "steakhouse",     emoji: "🥩", label: "Steakhouse" },
];

const MIN_SELECTION = 3;
const MAX_SELECTION = 6;

export default function TastePreferencesScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  function toggle(key: string) {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(key)) {
        next.delete(key);
      } else if (next.size < MAX_SELECTION) {
        next.add(key);
      }
      return next;
    });
  }

  async function handleNext() {
    setSaving(true);
    try {
      await saveTastePreferences([...selected]);
      void track("taste_prefs_completed", { count: selected.size });
      router.push("/onboarding/why-location");
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message ?? "Try again");
    } finally {
      setSaving(false);
    }
  }

  function skip() {
    router.push("/onboarding/why-location");
  }

  const enough = selected.size >= MIN_SELECTION;
  const subline = enough
    ? `${selected.size} picked · tap "Save" when ready`
    : `Pick at least ${MIN_SELECTION} (you've picked ${selected.size})`;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.head}>
        <Text style={styles.h1}>What do you actually crave?</Text>
        <Spacer size={8} />
        <Text style={styles.p}>
          Pick {MIN_SELECTION}–{MAX_SELECTION} cuisines you find yourself going back to.
          We'll use them to seed your first recommendations — refined later by what
          you actually eat.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {CUISINES.map((c) => {
          const active = selected.has(c.key);
          return (
            <Pressable
              key={c.key}
              onPress={() => toggle(c.key)}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
            >
              <Text style={styles.chipEmoji}>{c.emoji}</Text>
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.cta}>
        <Text style={styles.subline}>{subline}</Text>
        <Spacer size={10} />
        <Button
          title={saving ? "Saving…" : "Save & continue"}
          onPress={handleNext}
          loading={saving}
          variant={enough ? "primary" : "ghost"}
          disabled={!enough}
        />
        <Spacer size={8} />
        <Pressable onPress={skip} style={styles.skipBtn}>
          <Text style={styles.skipText}>Skip for now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  head: { padding: spacing.lg, paddingTop: spacing.xxl },
  h1: { ...type.title, color: colors.ink, fontSize: 28, lineHeight: 32 },
  p: { ...type.body, color: colors.mute, lineHeight: 22 },
  grid: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  chipActive: {
    borderColor: colors.red,
    backgroundColor: "#FFF1EE",
  },
  chipEmoji: { fontSize: 18 },
  chipLabel: { fontSize: 14, fontWeight: "600", color: colors.ink },
  chipLabelActive: { color: colors.red },
  cta: { padding: spacing.lg, borderTopColor: colors.line, borderTopWidth: 1 },
  subline: { ...type.small, textAlign: "center" },
  skipBtn: { alignItems: "center", paddingVertical: 8 },
  skipText: { color: colors.mute, fontSize: 13, fontWeight: "600" },
});
