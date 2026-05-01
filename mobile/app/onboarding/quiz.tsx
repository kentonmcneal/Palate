import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import {
  QUIZ_QUESTIONS,
  tallyPersona,
  chipsFromAnswers,
  type QuizOption,
} from "../../lib/starter-quiz";
import { saveQuizResult } from "../../lib/profile";

export default function QuizScreen() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<QuizOption[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const total = QUIZ_QUESTIONS.length;
  const q = QUIZ_QUESTIONS[step];

  async function pick(option: QuizOption) {
    const next = [...answers, option];
    setAnswers(next);
    setFeedback(option.feedback);

    // Show micro-feedback ~700ms then advance
    setTimeout(async () => {
      setFeedback(null);
      if (next.length === total) {
        await finish(next);
      } else {
        setStep((s) => s + 1);
      }
    }, 750);
  }

  async function finish(allAnswers: QuizOption[]) {
    setSaving(true);
    try {
      const persona = tallyPersona(allAnswers);
      const chips = chipsFromAnswers(allAnswers);
      await saveQuizResult(persona, chips);
      router.replace({
        pathname: "/onboarding/starter-result",
        params: { persona, chips: JSON.stringify(chips) },
      });
    } catch (e: any) {
      Alert.alert("Couldn't save quiz", e?.message ?? "Try again");
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.head}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${((step + 1) / total) * 100}%` }]} />
        </View>
        <Text style={styles.progressLabel}>
          Question {step + 1} of {total} · ~60 seconds
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.eyebrow}>BUILD YOUR STARTER PALATE</Text>
        <Spacer size={6} />
        <Text style={styles.prompt}>{q.prompt}</Text>
        <Spacer size={20} />

        {q.options.map((o) => (
          <Pressable
            key={o.text}
            onPress={() => pick(o)}
            style={({ pressed }) => [styles.opt, pressed && styles.optPressed]}
            disabled={saving || feedback !== null}
          >
            <Text style={styles.optEmoji}>{o.emoji}</Text>
            <Text style={styles.optText}>{o.text}</Text>
          </Pressable>
        ))}

        {feedback && (
          <View style={styles.feedback}>
            <Text style={styles.feedbackText}>{feedback}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  head: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.faint,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.red },
  progressLabel: { ...type.small, marginTop: 8, fontWeight: "600" },

  body: { padding: spacing.lg, paddingTop: spacing.md, paddingBottom: 60 },
  eyebrow: { ...type.micro },
  prompt: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.ink,
    letterSpacing: -0.4,
    lineHeight: 30,
  },

  opt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: spacing.md,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  optPressed: { backgroundColor: colors.faint, borderColor: colors.red },
  optEmoji: { fontSize: 22 },
  optText: { flex: 1, fontSize: 15, color: colors.ink, fontWeight: "500", lineHeight: 21 },

  feedback: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.ink,
  },
  feedbackText: { color: "#fff", fontSize: 14, fontWeight: "600", textAlign: "center" },
});
