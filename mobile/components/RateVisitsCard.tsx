import { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Text } from "./Text";
import { colors, spacing, type, card, shadow, categoryColors } from "../theme";
import { FONT_CAP } from "../lib/a11y";
import { track } from "../lib/analytics";
import { triggerHapticSelection, triggerHapticSuccess } from "../lib/haptics";
import { rateVisit } from "../lib/visits";
import {
  loadUnratedVisits, whenLabel, backlogLine, type UnratedVisit,
} from "../lib/rate-backlog";

// ============================================================================
// RateVisitsCard — asking about meals the app already knows you ate.
// ----------------------------------------------------------------------------
// 53 of 55 visits carry no rating, so the ranker has been generalising from
// where somebody went and not at all from whether it was good. A rating is the
// only signal that reaches cuisine cross-learning, which is the mechanism by
// which one great Vietnamese dinner improves a recommendation for a Vietnamese
// place you have never heard of.
//
// One question at a time, oldest first, three answers, and a Skip that means
// skip rather than "not for me". It renders nothing once the backlog is clear,
// and it never shows a count to clear or a streak to protect.
// ============================================================================

const ANSWERS = [
  { key: "loved", label: "Loved it", hue: categoryColors.pine },
  { key: "ok", label: "It was fine", hue: categoryColors.saffron },
  { key: "not_for_me", label: "Not for me", hue: categoryColors.clay },
] as const;

export function RateVisitsCard() {
  const [queue, setQueue] = useState<UnratedVisit[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void loadUnratedVisits().then(setQueue).catch(() => setQueue([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const current = queue?.[0] ?? null;

  function advance() {
    setQueue((q) => (q ? q.slice(1) : q));
  }

  async function answer(rating: "loved" | "ok" | "not_for_me") {
    if (!current || busy) return;
    setBusy(true);
    // Advance first. The rating is a column update that either lands or does
    // not; making somebody wait on a round trip to see the next question turns
    // a two-second favour into a chore.
    advance();
    try {
      await rateVisit(current.id, rating);
      void triggerHapticSuccess();
      void track("visit_rated", { rating, surface: "backlog" });
    } catch {
      // Put it back rather than losing the meal from the queue silently.
      setQueue((q) => (q ? [current, ...q] : [current]));
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    if (!current) return;
    void triggerHapticSelection();
    void track("visit_rating_skipped", { surface: "backlog" });
    // Skipped, not rated: it stays unrated in the database and will be offered
    // again another day. A skip is "I do not remember", not a verdict.
    advance();
  }

  if (!current) return null;
  const line = backlogLine(queue?.length ?? 0);
  const sub = [current.cuisine, whenLabel(current.visitedAt)].filter(Boolean).join(" · ");

  return (
    <View style={styles.card}>
      {/* Shadow outside, clip inside: iOS drops a view's own shadow when that
          view clips its children. Same build as every other card. */}
      <View style={styles.clip}>
        <View style={styles.rail} />
        <View style={styles.body}>
          <Text style={styles.eyebrow} maxFontSizeMultiplier={FONT_CAP.eyebrow}>HOW WAS IT</Text>
          <Text style={styles.title} numberOfLines={2}>{current.name}</Text>
          {!!sub && <Text style={styles.sub}>{sub}</Text>}

          <View style={styles.row}>
            {ANSWERS.map((a) => (
              <Pressable
                key={a.key}
                onPress={() => void answer(a.key)}
                disabled={busy}
                style={[styles.answer, { borderColor: a.hue }, busy && styles.answerOff]}
                accessibilityRole="button"
                accessibilityLabel={`${a.label}, ${current.name}`}
              >
                <Text
                  style={[styles.answerText, { color: a.hue }]}
                  maxFontSizeMultiplier={FONT_CAP.chrome}
                  numberOfLines={1}
                >
                  {a.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.footer}>
            {!!line && <Text style={styles.line}>{line}</Text>}
            <Pressable onPress={skip} hitSlop={8} accessibilityRole="button">
              <Text style={styles.skip}>I do not remember</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    // No horizontal margin: ProfileBody's ScrollView already pads to
    // spacing.lg, and a margin here would inset it past every other card.
    marginTop: spacing.lg,
    borderRadius: card.radius, backgroundColor: colors.faint,
    ...shadow.card,
  },
  clip: { borderRadius: card.radius, overflow: "hidden" },
  // Olive: not plum (people), not terracotta (the inbox). This one is memory.
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: categoryColors.olive },
  body: { padding: card.padding },
  eyebrow: { ...type.micro, color: categoryColors.olive },
  title: { ...type.cardTitle, color: colors.ink, marginTop: 6 },
  sub: { ...type.small, marginTop: 4 },

  row: { flexDirection: "row", gap: 8, marginTop: 14 },
  answer: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingVertical: 12, paddingHorizontal: 6,
    borderRadius: 12, borderWidth: 1.5, backgroundColor: colors.faint,
  },
  answerOff: { opacity: 0.4 },
  answerText: { fontSize: 13, fontWeight: "800" },

  footer: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: 12, gap: 12,
  },
  line: { ...type.small, color: colors.mute, flexShrink: 1 },
  skip: { fontSize: 13, fontWeight: "700", color: colors.mute },
});
