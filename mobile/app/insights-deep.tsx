import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Spacer } from "../components/Button";
import { colors, spacing, type } from "../theme";
import { computeTasteVector, type TasteVector } from "../lib/taste-vector";
import { generateIdentitySet, expandedLore, type PalateIdentitySet } from "../lib/palate-labels";
import { generatePercentileCards, generateCohortInsightAsync, type CohortInsight } from "../lib/population-stats";
import { computeAspirationalPalate, type AspirationalPalate } from "../lib/aspirational-palate";
import { getAreaPalates, type AreaPalateSummary } from "../lib/area-palates";
import { getSessionStage, type SessionStage } from "../lib/session-stage";

// ============================================================================
// Insights Deep — Profile → "Your Insights" view. Aggregates everything
// that used to be scattered across Wrapped + Home: Palate Lore, Percentiles,
// People-Like-You cohort, Aspirational Palate, Top Palates in your area.
//
// Wrapped now just shows the persona + key stats. Identity depth lives here.
// ============================================================================

export default function InsightsDeepScreen() {
  const router = useRouter();
  const [vector, setVector] = useState<TasteVector | null>(null);
  const [identities, setIdentities] = useState<PalateIdentitySet | null>(null);
  const [cohort, setCohort] = useState<CohortInsight | null>(null);
  const [aspirational, setAspirational] = useState<AspirationalPalate | null>(null);
  const [area, setArea] = useState<AreaPalateSummary | null>(null);
  const [stage, setStage] = useState<SessionStage>(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const s = await getSessionStage().catch(() => 1 as SessionStage);
      setStage(s);
      if (s < 3) {
        setVector(null);
        setIdentities(null);
        setCohort(null);
        setAspirational(null);
        setArea(null);
        return;
      }
      const [v, asp, ar] = await Promise.all([
        computeTasteVector().catch(() => null),
        computeAspirationalPalate().catch(() => null),
        getAreaPalates().catch(() => null),
      ]);
      setVector(v);
      setAspirational(asp);
      setArea(ar);
      if (v) {
        const ids = generateIdentitySet(v);
        setIdentities(ids);
        const c = await generateCohortInsightAsync(ids.primary, v).catch(() => null);
        setCohort(c);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Your Insights</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
        ) : stage < 3 ? (
          <View style={styles.lockedCard}>
            <Text style={styles.lockedTitle}>Insights unlock at 3 visits</Text>
            <Text style={styles.lockedBody}>
              {stage === 1
                ? "Log your first visit and we'll start learning your palate."
                : "You're close. A couple more visits and your full insights open up."}
            </Text>
          </View>
        ) : (
          <>
            {/* Palate Lore */}
            {identities && (
              <View style={styles.card}>
                <Text style={styles.eyebrow}>PALATE LORE</Text>
                <Text style={styles.cardTitle}>{identities.primary.label}</Text>
                {(() => {
                  const lore = expandedLore(identities.primary);
                  return (
                    <>
                      <Text style={styles.body1}>{lore.story}</Text>
                      <Spacer size={10} />
                      <Text style={styles.body1}>{lore.behavior}</Text>
                    </>
                  );
                })()}
              </View>
            )}

            {/* Percentiles */}
            {vector && identities && (
              <View style={styles.card}>
                <Text style={styles.eyebrow}>WHERE YOU RANK</Text>
                {generatePercentileCards(vector, identities.primary).map((c, i) => (
                  <View key={i} style={styles.row}>
                    <Text style={styles.rowLeft}>Top {c.percentile}%</Text>
                    <Text style={styles.rowRight}>{c.body}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* People like you */}
            {cohort && (
              <View style={styles.card}>
                <Text style={styles.eyebrow}>
                  PEOPLE LIKE YOU{cohort.source === "preview" ? " · preview" : ""}
                </Text>
                <Text style={styles.cardTitle}>{cohort.countLine}</Text>
                <Text style={styles.body1}>· {cohort.paceLine}</Text>
                <Text style={styles.body1}>· {cohort.citiesLine}</Text>
                <Text style={styles.body1}>· {cohort.topSavedLine}</Text>
              </View>
            )}

            {/* Aspirational */}
            {aspirational && (
              <View style={[styles.card, { backgroundColor: colors.ink }]}>
                <Text style={[styles.eyebrow, { color: "rgba(255,255,255,0.6)" }]}>YOUR NEXT ERA</Text>
                <Text style={[styles.cardTitle, { color: "#fff" }]}>{aspirational.insight}</Text>
                {aspirational.topAspirationTags.length > 0 && (
                  <View style={styles.tagRow}>
                    {aspirational.topAspirationTags.slice(0, 4).map((t) => (
                      <View key={t.tag} style={styles.darkChip}>
                        <Text style={styles.darkChipText}>{t.tag.replace(/_/g, " ")}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Top palates in area */}
            {area && area.palates.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.eyebrow}>
                  TOP PALATES IN {area.area.toUpperCase()}
                  {area.source === "preview" ? " · preview" : ""}
                </Text>
                {area.palates.map((p, i) => (
                  <View key={p.label} style={styles.row}>
                    <Text style={styles.rowLeft}>{i + 1}. {p.label}</Text>
                    <Text style={styles.rowRight}>{Math.round(p.share * 100)}%</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
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
  center: { padding: 60, alignItems: "center" },
  card: {
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.line,
    marginBottom: 12,
  },
  eyebrow: { ...type.micro, color: colors.red },
  cardTitle: { fontSize: 18, fontWeight: "800", color: colors.ink, marginTop: 8, letterSpacing: -0.3, lineHeight: 24 },
  body1: { fontSize: 14, color: colors.ink, marginTop: 8, lineHeight: 20 },

  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderTopColor: colors.line, borderTopWidth: 1 },
  rowLeft: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.ink },
  rowRight: { fontSize: 13, color: colors.mute, marginLeft: 12 },

  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  darkChip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
  },
  darkChipText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  lockedCard: {
    padding: spacing.lg,
    borderRadius: 18,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
    alignItems: "center",
  },
  lockedTitle: { fontSize: 16, fontWeight: "800", color: colors.ink, letterSpacing: -0.2 },
  lockedBody: { fontSize: 13, color: colors.mute, marginTop: 8, textAlign: "center", lineHeight: 18 },
});
