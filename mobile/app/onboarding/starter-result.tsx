import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { STARTER_PERSONAS, type StarterPersonaKey } from "../../lib/starter-quiz";

export default function StarterResultScreen() {
  const router = useRouter();
  const { persona, chips } = useLocalSearchParams<{ persona: string; chips: string }>();
  const key = (persona as StarterPersonaKey) ?? "convenience_loyalist";
  const p = STARTER_PERSONAS[key];
  const parsedChips: string[] = (() => {
    try { return JSON.parse(chips ?? "[]"); } catch { return []; }
  })();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.eyebrow}>YOUR STARTER PALATE</Text>
        <Spacer size={6} />
        <Text style={styles.label}>{p.label}</Text>
        <Spacer size={6} />
        <Text style={styles.tagline}>{p.tagline}</Text>

        <Spacer size={20} />
        <Text style={styles.insight}>"{p.insight}"</Text>

        {parsedChips.length > 0 && (
          <View style={styles.chipRow}>
            {parsedChips.map((c) => (
              <View key={c} style={styles.chip}>
                <Text style={styles.chipText}>{c}</Text>
              </View>
            ))}
          </View>
        )}

        <Spacer size={28} />

        {/* Insights */}
        <View style={styles.card}>
          <Text style={type.micro}>WHAT THIS MEANS</Text>
          <Spacer size={10} />
          {p.insights.map((insight, i) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>·</Text>
              <Text style={styles.bulletText}>{insight}</Text>
            </View>
          ))}
        </View>

        <Spacer size={14} />

        {/* 3 recs */}
        <View style={styles.card}>
          <Text style={type.micro}>YOUR KIND OF PLACE</Text>
          <Spacer size={10} />
          {p.recs.map((rec, i) => (
            <View key={i} style={styles.recRow}>
              <View style={styles.recBadge}><Text style={styles.recBadgeText}>{i + 1}</Text></View>
              <Text style={styles.recName}>{rec}</Text>
            </View>
          ))}
        </View>

        <Spacer size={14} />

        {/* 1 stretch */}
        <View style={[styles.card, styles.stretchCard]}>
          <Text style={[type.micro, { color: colors.red }]}>STRETCH PICK</Text>
          <Spacer size={10} />
          <Text style={styles.stretchName}>{p.stretch.name}</Text>
          <Spacer size={4} />
          <Text style={styles.stretchReason}>{p.stretch.reason}</Text>
        </View>

        <Spacer size={28} />

        <View style={styles.expectation}>
          <Text style={styles.expectationEyebrow}>HEADS UP</Text>
          <Text style={styles.expectationBody}>
            This is your <Text style={{ fontWeight: "800", color: colors.ink }}>Starter Palate</Text>.
            Your real Palate is based on where you actually go — by Sunday, we'll know more.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.cta}>
        <Button title="Continue" onPress={() => router.replace("/onboarding/taste-preferences")} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: 40 },
  cta: { padding: spacing.lg, borderTopColor: colors.line, borderTopWidth: 1 },

  eyebrow: { ...type.micro },
  label: {
    fontSize: 32,
    fontWeight: "800",
    color: colors.ink,
    letterSpacing: -0.8,
    lineHeight: 36,
  },
  tagline: { ...type.body, color: colors.mute, fontStyle: "italic", lineHeight: 22 },
  insight: {
    fontSize: 18,
    color: colors.ink,
    lineHeight: 26,
    fontStyle: "italic",
    paddingLeft: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.red,
  },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 16 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipText: { fontSize: 11, fontWeight: "700", color: colors.ink },

  card: {
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },

  bulletRow: { flexDirection: "row", gap: 10, paddingVertical: 4, alignItems: "flex-start" },
  bulletDot: { color: colors.red, fontSize: 16, fontWeight: "800", lineHeight: 20 },
  bulletText: { flex: 1, fontSize: 14, color: colors.ink, lineHeight: 20 },

  recRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 8,
    borderTopColor: colors.line,
    borderTopWidth: 1,
  },
  recBadge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.red,
    alignItems: "center", justifyContent: "center",
  },
  recBadgeText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  recName: { fontSize: 15, fontWeight: "600", color: colors.ink },

  stretchCard: { borderColor: colors.red, backgroundColor: "#FFF7F4" },
  stretchName: { fontSize: 20, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 },
  stretchReason: { fontSize: 13, color: colors.mute, lineHeight: 19 },

  expectation: {
    padding: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.ink,
  },
  expectationEyebrow: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  expectationBody: { color: "rgba(255,255,255,0.85)", fontSize: 14, lineHeight: 22, marginTop: 8 },
});
