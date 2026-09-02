import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { colors, card, radius, shadow, type } from "../theme";
import { ensureRated, nextComparison, recordComparison, type RankedPlace } from "../lib/rankings-store";
import { triggerHapticSelection } from "../lib/haptics";

// ============================================================================
// ComparisonPrompt — ONE question, never a queue.
// ----------------------------------------------------------------------------
// This is the whole ranked-list mechanic. Beli makes you binary-search a new
// place into position, which is a sequence of questions right when someone
// wants to put their phone down. We ask one, and Elo does the rest over time
// (lib/ranking.ts explains why that trade is the right one).
//
// It shows nothing at all when there is nothing useful to ask — a first rated
// place has no opponent, and inventing one would teach us nothing while costing
// the user a tap. Silence is the correct output more often than not.
// ============================================================================

export function ComparisonPrompt({ restaurantId }: { restaurantId: string }) {
  const [pair, setPair] = useState<{ subject: RankedPlace; opponent: RankedPlace } | null>(null);
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // The place must be in the pool before it can be compared against it.
        await ensureRated(restaurantId);
        const next = await nextComparison(restaurantId);
        if (alive) setPair(next);
      } catch {
        // A missing question is not an error worth showing anyone.
        if (alive) setPair(null);
      }
    })();
    return () => { alive = false; };
  }, [restaurantId]);

  if (!pair || answered) return null;

  async function answer(subjectWon: boolean) {
    if (!pair) return;
    setBusy(true);
    void triggerHapticSelection();
    try {
      await recordComparison(
        subjectWon ? pair.subject : pair.opponent,
        subjectWon ? pair.opponent : pair.subject,
      );
    } catch {
      // Swallow: the visit is already saved and the ranking is a nicety.
    } finally {
      setAnswered(true);
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>ONE QUICK ONE</Text>
      <Text style={styles.question}>
        Which was better?
      </Text>
      <View style={styles.row}>
        <Pressable
          onPress={() => void answer(true)}
          disabled={busy}
          style={[styles.choice, busy && styles.dim]}
          accessibilityRole="button"
        >
          <Text style={styles.choiceName} numberOfLines={2}>{pair.subject.name}</Text>
          <Text style={styles.choiceMeta}>just now</Text>
        </Pressable>

        <Text style={styles.vs}>or</Text>

        <Pressable
          onPress={() => void answer(false)}
          disabled={busy}
          style={[styles.choice, busy && styles.dim]}
          accessibilityRole="button"
        >
          <Text style={styles.choiceName} numberOfLines={2}>{pair.opponent.name}</Text>
          {!!pair.opponent.cuisine && (
            <Text style={styles.choiceMeta}>{pair.opponent.cuisine}</Text>
          )}
        </Pressable>
      </View>

      {busy && <ActivityIndicator style={{ marginTop: 10 }} color={colors.red} />}

      <Pressable onPress={() => setAnswered(true)} style={styles.skip} accessibilityRole="button">
        <Text style={styles.skipText}>Too close to call</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: card.padding,
    borderRadius: card.radius,
    backgroundColor: colors.faint,
    marginBottom: 14,
    ...shadow.card,
  },
  eyebrow: { ...type.micro },
  question: { fontSize: 16, fontWeight: "800", color: colors.ink, marginTop: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  choice: {
    flex: 1,
    minHeight: 64,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: "center",
  },
  dim: { opacity: 0.6 },
  choiceName: { fontSize: 15, fontWeight: "700", color: colors.ink },
  choiceMeta: { ...type.small, marginTop: 2 },
  vs: { ...type.small, fontWeight: "700" },
  skip: { alignSelf: "flex-start", marginTop: 10, paddingVertical: 6 },
  skipText: { color: colors.mute, fontSize: 13, fontWeight: "600" },
});
