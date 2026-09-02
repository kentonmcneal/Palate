import { View, Text, StyleSheet, ScrollView } from "react-native";
import { colors, spacing, type, card } from "../theme";

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
  return (
    <View style={styles.wrap}>
      <View style={styles.heroCard}>
        <Text style={styles.heroEyebrow}>YOUR PALATE STARTS HERE</Text>
        <Text style={styles.heroTitle}>
          This is what you&apos;re building toward.
        </Text>
        <Text style={styles.heroBody}>
          Palate gets sharper the more you log. By Sunday you'll see what
          your week actually says about you.
        </Text>
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

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  heroCard: {
    padding: spacing.lg,
    borderRadius: card.radius,
    backgroundColor: colors.ink,
  },
  heroEyebrow: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  heroTitle: { color: "#fff", fontSize: 24, fontWeight: "800", letterSpacing: -0.5, marginTop: 10, lineHeight: 30 },
  heroBody: { color: "rgba(255,255,255,0.85)", fontSize: 14, lineHeight: 21, marginTop: 10 },


  personasCard: {
    padding: spacing.md,
    borderRadius: card.radius,
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
