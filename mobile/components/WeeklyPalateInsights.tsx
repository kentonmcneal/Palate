import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from "react-native";
import { colors, spacing, type } from "../theme";
import { addToWishlist, type RestaurantRecommendation } from "../lib/palate-insights";
import {
  generateWeeklyPalatePersona,
  getPersonaRecommendations,
  type PalatePersona,
} from "../lib/palate-persona";
import { Spacer } from "./Button";

type Props = {
  weekStart: string;
  weekEnd: string;
  /** Optional fallback location used only when no week-anchor exists. */
  fallbackAnchor?: { lat: number; lng: number };
};

type LoadState =
  | { kind: "loading" }
  | { kind: "empty" } // 0 visits this week
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      persona: PalatePersona;
      recs: { similar: RestaurantRecommendation[]; stretch: RestaurantRecommendation | null };
    };

export function WeeklyPalateInsights({ weekStart, weekEnd, fallbackAnchor }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const persona = await generateWeeklyPalatePersona(weekStart, weekEnd);
      if (!persona) {
        setState({ kind: "empty" });
        return;
      }
      const recs = await getPersonaRecommendations(persona, weekStart, weekEnd, fallbackAnchor);
      setState({ kind: "ready", persona, recs });
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

      {state.kind === "empty" && (
        <View style={styles.warmingCard}>
          <Text style={type.subtitle}>Your Palate is still warming up.</Text>
          <Text style={[type.small, { marginTop: 6 }]}>
            Visit a few more spots to unlock your identity.
          </Text>
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

      {state.kind === "ready" && <ReadyView persona={state.persona} recs={state.recs} />}
    </View>
  );
}

// ============================================================================
// Persona reveal
// ============================================================================

function ReadyView({
  persona,
  recs,
}: {
  persona: PalatePersona;
  recs: { similar: RestaurantRecommendation[]; stretch: RestaurantRecommendation | null };
}) {
  const lowConfidence = persona.confidenceScore < 0.4;

  return (
    <>
      <Text style={styles.personaLabel}>{persona.label}</Text>
      <Text style={styles.personaTagline}>"{persona.tagline}"</Text>
      <Text style={styles.personaDescription}>{persona.description}</Text>

      {persona.evidence.length > 0 && (
        <View style={styles.evidenceBox}>
          <Text style={styles.evidenceLabel}>WHY THIS WEEK</Text>
          {persona.evidence.map((line) => (
            <Text key={line} style={styles.evidenceItem}>• {line}</Text>
          ))}
        </View>
      )}

      {lowConfidence && (
        <Text style={[type.small, { marginTop: 12, fontStyle: "italic" }]}>
          (Early read — your Palate sharpens with more visits.)
        </Text>
      )}

      {recs.similar.length > 0 && (
        <View style={{ marginTop: spacing.xl }}>
          <Text style={styles.sectionLabel}>Try next — places you'll probably like</Text>
          <Spacer size={10} />
          {recs.similar.map((r) => (
            <RecCard key={r.google_place_id} rec={r} kind="similar" />
          ))}
        </View>
      )}

      {recs.stretch && (
        <View style={{ marginTop: spacing.xl }}>
          <Text style={styles.sectionLabel}>One place to stretch your Palate</Text>
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
  personaLabel: {
    marginTop: 10,
    color: colors.red,
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.6,
    lineHeight: 34,
  },
  personaTagline: {
    marginTop: 4,
    color: colors.ink,
    fontSize: 17,
    fontStyle: "italic",
  },
  personaDescription: {
    marginTop: 14,
    color: colors.ink,
    fontSize: 16,
    lineHeight: 24,
  },
  evidenceBox: {
    marginTop: 18,
    paddingTop: 14,
    borderTopColor: colors.line,
    borderTopWidth: 1,
  },
  evidenceLabel: { ...type.micro, marginBottom: 6 },
  evidenceItem: {
    color: colors.mute,
    fontSize: 14,
    lineHeight: 22,
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
  warmingCard: {
    marginTop: 14,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
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
