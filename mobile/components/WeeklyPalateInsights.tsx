import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from "react-native";
import { colors, spacing, type } from "../theme";
import {
  analyzeWeeklyPalate,
  getPalateRecommendations,
  addToWishlist,
  type PalateInsight,
  type PalateRecommendations,
  type RestaurantRecommendation,
} from "../lib/palate-insights";
import { Spacer } from "./Button";

type Props = {
  weekStart: string;
  weekEnd: string;
  /** Optional fallback location used only when the user has zero anchored visits. */
  fallbackAnchor?: { lat: number; lng: number };
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; insight: PalateInsight; recs: PalateRecommendations };

export function WeeklyPalateInsights({ weekStart, weekEnd, fallbackAnchor }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const insight = await analyzeWeeklyPalate(weekStart, weekEnd);
      const recs = await getPalateRecommendations(insight, fallbackAnchor);
      setState({ kind: "ready", insight, recs });
    } catch (e: any) {
      setState({ kind: "error", message: e?.message ?? "Couldn't analyze your week" });
    }
  }, [weekStart, weekEnd, fallbackAnchor]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>YOUR PALATE THIS WEEK</Text>

      {state.kind === "loading" && (
        <View style={styles.skeleton}>
          <ActivityIndicator color={colors.red} />
          <Text style={[type.small, { marginTop: 10 }]}>Reading your week…</Text>
        </View>
      )}

      {state.kind === "error" && (
        <View style={styles.errorCard}>
          <Text style={type.subtitle}>Couldn't load insights</Text>
          <Text style={[type.small, { marginTop: 4 }]}>{state.message}</Text>
          <Spacer size={12} />
          <Pressable onPress={load} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable>
        </View>
      )}

      {state.kind === "ready" && (
        <ReadyView insight={state.insight} recs={state.recs} />
      )}
    </View>
  );
}

function ReadyView({ insight, recs }: { insight: PalateInsight; recs: PalateRecommendations }) {
  const noRecs = recs.similar.length === 0 && !recs.stretch;

  return (
    <>
      <Text style={styles.copy}>{insight.copy}</Text>

      {insight.isLowData && noRecs && (
        <Text style={[type.small, { marginTop: 10 }]}>
          Once you've logged a few spots near home, we'll surface places to try.
        </Text>
      )}

      {recs.similar.length > 0 && (
        <View style={{ marginTop: spacing.xl }}>
          <Text style={styles.sectionLabel}>3 places you might like to try</Text>
          <Spacer size={10} />
          {recs.similar.map((r) => (
            <RecCard key={r.google_place_id} rec={r} kind="similar" />
          ))}
        </View>
      )}

      {recs.stretch && (
        <View style={{ marginTop: spacing.xl }}>
          <Text style={styles.sectionLabel}>1 place to stretch your Palate</Text>
          <Spacer size={10} />
          <RecCard rec={recs.stretch} kind="stretch" />
        </View>
      )}
    </>
  );
}

function RecCard({ rec, kind }: { rec: RestaurantRecommendation; kind: "similar" | "stretch" }) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (saved || saving) return;
    setSaving(true);
    try {
      await addToWishlist(rec.google_place_id);
      setSaved(true);
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message ?? "Try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.card, kind === "stretch" && styles.cardStretch]}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName}>{rec.name}</Text>
          <Text style={styles.cardSub}>
            {[rec.cuisine ? capitalize(rec.cuisine) : null, rec.neighborhood]
              .filter(Boolean)
              .join(" · ") || "Nearby"}
          </Text>
        </View>
        <Pressable
          onPress={handleSave}
          style={[styles.saveBtn, saved && styles.saveBtnDone]}
          accessibilityRole="button"
          accessibilityLabel={saved ? "Saved" : "Save to your list"}
        >
          <Text style={[styles.saveText, saved && styles.saveTextDone]}>
            {saving ? "…" : saved ? "Saved" : "Save"}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.cardReason}>{rec.reason}</Text>
    </View>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: 24,
    backgroundColor: colors.faint,
  },
  eyebrow: { ...type.micro },
  copy: {
    ...type.subtitle,
    marginTop: 8,
    lineHeight: 26,
    color: colors.ink,
  },
  sectionLabel: {
    ...type.micro,
    color: colors.mute,
  },
  card: {
    backgroundColor: colors.paper,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    marginBottom: 10,
  },
  cardStretch: {
    borderColor: colors.red,
    borderWidth: 1.5,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  cardName: { ...type.subtitle },
  cardSub: { ...type.small, marginTop: 2 },
  cardReason: {
    marginTop: 10,
    color: colors.mute,
    fontSize: 14,
    lineHeight: 19,
    fontStyle: "italic",
  },
  saveBtn: {
    paddingHorizontal: 14,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnDone: {
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  saveText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  saveTextDone: { color: colors.mute },
  skeleton: {
    marginTop: 16,
    paddingVertical: 30,
    alignItems: "center",
  },
  errorCard: {
    marginTop: 16,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  retry: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: colors.red,
  },
  retryText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
