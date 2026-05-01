import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button, Spacer } from "../components/Button";
import { colors, spacing, type } from "../theme";
import { getMyProfile, saveDemographics, type AgeRange } from "../lib/profile";

const AGE_RANGES: { key: AgeRange; label: string }[] = [
  { key: "under_18", label: "Under 18" },
  { key: "18_24", label: "18-24" },
  { key: "25_34", label: "25-34" },
  { key: "35_44", label: "35-44" },
  { key: "45_54", label: "45-54" },
  { key: "55_64", label: "55-64" },
  { key: "65_plus", label: "65+" },
];

const GENDER_OPTIONS = ["Woman", "Man", "Non-binary", "Prefer to self-describe", "Prefer not to say"];

const RACE_OPTIONS = [
  "Asian",
  "Black or African American",
  "Hispanic or Latino",
  "Middle Eastern or North African",
  "Native American or Alaska Native",
  "Native Hawaiian or Pacific Islander",
  "White",
  "Multiracial",
  "Prefer not to say",
];

export default function DemographicsScreen() {
  const router = useRouter();
  const [age, setAge] = useState<AgeRange | null>(null);
  const [gender, setGender] = useState<string | null>(null);
  const [genderCustom, setGenderCustom] = useState("");
  const [races, setRaces] = useState<Set<string>>(new Set());
  const [hometown, setHometown] = useState("");
  const [city, setCity] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMyProfile().then((p) => {
      if (!p) return;
      setAge(p.age_range);
      setGender(p.gender_identity);
      if (p.race_ethnicity?.length) setRaces(new Set(p.race_ethnicity));
      setHometown(p.hometown ?? "");
      setCity(p.current_city ?? "");
    }).catch(() => {});
  }, []);

  function toggleRace(r: string) {
    setRaces((curr) => {
      const next = new Set(curr);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      await saveDemographics({
        age_range: age,
        gender_identity: gender === "Prefer to self-describe" ? genderCustom.trim() || null : gender,
        race_ethnicity: [...races],
        hometown: hometown.trim() || null,
        current_city: city.trim() || null,
      });
      router.back();
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "Try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>About you</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.intro}>
          All optional. Used to power "Top Palates in your demographic" and richer cohort comparisons.
          We never sell your data and never publicly show this on your profile.
        </Text>

        <Section title="Age range">
          <View style={styles.chipGrid}>
            {AGE_RANGES.map((a) => (
              <Pressable
                key={a.key}
                onPress={() => setAge(age === a.key ? null : a.key)}
                style={[styles.chip, age === a.key && styles.chipActive]}
              >
                <Text style={[styles.chipText, age === a.key && styles.chipTextActive]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title="Gender identity">
          <View style={styles.chipGrid}>
            {GENDER_OPTIONS.map((g) => (
              <Pressable
                key={g}
                onPress={() => setGender(gender === g ? null : g)}
                style={[styles.chip, gender === g && styles.chipActive]}
              >
                <Text style={[styles.chipText, gender === g && styles.chipTextActive]}>{g}</Text>
              </Pressable>
            ))}
          </View>
          {gender === "Prefer to self-describe" && (
            <TextInput
              value={genderCustom}
              onChangeText={setGenderCustom}
              placeholder="How would you describe it?"
              placeholderTextColor={colors.mute}
              style={[styles.input, { marginTop: 10 }]}
              maxLength={40}
            />
          )}
        </Section>

        <Section title="Race / ethnicity">
          <Text style={styles.sublabel}>Select all that apply.</Text>
          <View style={styles.chipGrid}>
            {RACE_OPTIONS.map((r) => (
              <Pressable
                key={r}
                onPress={() => toggleRace(r)}
                style={[styles.chip, races.has(r) && styles.chipActive]}
              >
                <Text style={[styles.chipText, races.has(r) && styles.chipTextActive]}>{r}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title="Where you grew up">
          <TextInput
            value={hometown}
            onChangeText={setHometown}
            placeholder="e.g. Memphis, TN"
            placeholderTextColor={colors.mute}
            style={styles.input}
            maxLength={60}
          />
        </Section>

        <Section title="Where you live now">
          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder="e.g. Brooklyn, NY"
            placeholderTextColor={colors.mute}
            style={styles.input}
            maxLength={60}
          />
        </Section>

        <Spacer size={28} />
        <Button title={saving ? "Saving…" : "Save"} onPress={save} loading={saving} />
        <Spacer />
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: spacing.xl }}>
      <Text style={type.subtitle}>{title}</Text>
      <Spacer size={10} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.line, borderBottomWidth: 1,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.faint,
  },
  closeText: { fontSize: 18, fontWeight: "700", color: colors.ink },
  body: { padding: spacing.lg, paddingBottom: 80 },
  intro: { ...type.body, color: colors.mute, lineHeight: 22 },
  sublabel: { ...type.small, marginBottom: 8 },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.paper,
    borderWidth: 1.5, borderColor: colors.line,
  },
  chipActive: { borderColor: colors.red, backgroundColor: "#FFF1EE" },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.ink },
  chipTextActive: { color: colors.red },
  input: {
    height: 50, borderRadius: 14,
    borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 16, fontSize: 16, color: colors.ink,
  },
});
