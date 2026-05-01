import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";

const STARTER_PERSONAS = [
  { label: "The Convenience Loyalist", emoji: "⚡" },
  { label: "The Flavor Loyalist",      emoji: "🌶️" },
  { label: "The Café Dweller",         emoji: "☕" },
  { label: "The Healthy Optimizer",    emoji: "🥗" },
  { label: "The Comfort Connoisseur",  emoji: "🍝" },
  { label: "The Practical Variety Seeker", emoji: "🎲" },
  { label: "The Explorer",             emoji: "🌍" },
  { label: "The Premium Comfort Loyalist", emoji: "🥩" },
  { label: "The Social Diner",         emoji: "🥂" },
];

export function GettingStarted() {
  const router = useRouter();
  return (
    <View style={styles.wrap}>
      <View style={styles.heroCard}>
        <Text style={styles.heroEyebrow}>YOUR PALATE STARTS HERE</Text>
        <Text style={styles.heroTitle}>
          Three things to do before your first Wrapped.
        </Text>
        <Text style={styles.heroBody}>
          Palate gets sharper the more you log. By Sunday you'll see what
          your week actually says about you.
        </Text>
      </View>

      <View style={styles.steps}>
        <Step
          number="1"
          title="Log your first visit"
          body="Tap the + tab — pick a place you went today. Takes 5 seconds."
          cta="Add a visit"
          onPress={() => router.push("/(tabs)/add")}
        />
        <Step
          number="2"
          title="Preview a Wrapped"
          body="See what Sunday's reveal will feel like with sample data."
          cta="Open Wrapped"
          onPress={() => router.push("/(tabs)/wrapped")}
        />
        <Step
          number="3"
          title="Find a friend"
          body="The feed comes alive when one friend's on Palate too."
          cta="Find friends"
          onPress={() => router.push("/friends")}
        />
      </View>

      <View style={styles.personasCard}>
        <Text style={type.micro}>NINE WAYS YOUR PALATE COULD READ</Text>
        <Text style={[type.small, { marginTop: 4, marginBottom: 14, lineHeight: 20 }]}>
          By Sunday, your week will fall into one of these — based on what you
          actually eat, not what you say you like.
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {STARTER_PERSONAS.map((p) => (
            <View key={p.label} style={styles.personaChip}>
              <Text style={styles.personaEmoji}>{p.emoji}</Text>
              <Text style={styles.personaLabel}>{p.label}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function Step({
  number, title, body, cta, onPress,
}: {
  number: string;
  title: string;
  body: string;
  cta: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.step}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{number}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepBody}>{body}</Text>
        <Text style={styles.stepCta}>{cta} →</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  heroCard: {
    padding: spacing.lg,
    borderRadius: 24,
    backgroundColor: colors.ink,
  },
  heroEyebrow: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  heroTitle: { color: "#fff", fontSize: 24, fontWeight: "800", letterSpacing: -0.5, marginTop: 10, lineHeight: 30 },
  heroBody: { color: "rgba(255,255,255,0.85)", fontSize: 14, lineHeight: 21, marginTop: 10 },

  steps: { gap: 10 },
  step: {
    flexDirection: "row",
    gap: 14,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  stepNumber: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.red,
    alignItems: "center", justifyContent: "center",
  },
  stepNumberText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  stepTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  stepBody: { fontSize: 13, color: colors.mute, marginTop: 4, lineHeight: 18 },
  stepCta: { fontSize: 12, fontWeight: "700", color: colors.red, marginTop: 8, letterSpacing: 0.3 },

  personasCard: {
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  personaChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  personaEmoji: { fontSize: 16 },
  personaLabel: { fontSize: 12, fontWeight: "700", color: colors.ink },
});
