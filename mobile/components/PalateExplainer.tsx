import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, spacing, type } from "../theme";
import { getAreaPalates, type AreaPalateSummary } from "../lib/area-palates";

// ============================================================================
// PalateExplainer — short "what is a Palate" essay + "Top Palates in your
// area" card. Designed to feel a little like astrology — identity-coded
// pattern reading that hooks people.
// ============================================================================

const ESSAY = "Your Palate is the shape of how you actually eat. It's built from where you go, when you go, who you go with, and what you reach for when nothing's stopping you.";

const SUB = "Shaped by upbringing, geography, mood, identity, and the rituals you've quietly built without noticing. Most people don't know their Palate. Now you do.";

export function PalateExplainer() {
  const [expanded, setExpanded] = useState(false);
  const [area, setArea] = useState<AreaPalateSummary | null>(null);

  useEffect(() => {
    let alive = true;
    getAreaPalates().then((r) => { if (alive) setArea(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setExpanded((e) => !e)} style={styles.essayCard}>
        <Text style={styles.essayEyebrow}>WHAT'S A PALATE?</Text>
        <Text style={styles.essayBody}>{ESSAY}</Text>
        {expanded && (
          <>
            <Text style={[styles.essayBody, { marginTop: 10 }]}>{SUB}</Text>
            <Text style={[styles.essayBody, { marginTop: 10, fontStyle: "italic", color: colors.mute }]}>
              Most apps measure your opinions. Palate measures your patterns. The story is in the gap between what you say you like and what you actually choose.
            </Text>
          </>
        )}
        <Text style={styles.expandHint}>{expanded ? "Tap to collapse" : "Tap to read more"}</Text>
      </Pressable>

      {area && area.palates.length > 0 && (
        <View style={styles.areaCard}>
          <Text style={styles.areaEyebrow}>
            TOP PALATES IN {area.area.toUpperCase()}
            {area.source === "preview" ? " · preview data" : ""}
          </Text>
          {area.palates.map((p, i) => (
            <View key={p.label} style={styles.areaRow}>
              <Text style={styles.areaRank}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.areaLabel}>{p.label}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.round(p.share * 100 * 5)}%` }]} />
                </View>
              </View>
              <Text style={styles.areaPct}>{Math.round(p.share * 100)}%</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.xl, gap: 12 },

  essayCard: {
    padding: spacing.md,
    borderRadius: 22,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  essayEyebrow: { ...type.micro, color: colors.red },
  essayBody: { fontSize: 15, color: colors.ink, lineHeight: 22, marginTop: 10 },
  expandHint: { fontSize: 11, fontWeight: "700", color: colors.mute, marginTop: 12, letterSpacing: 0.5 },

  areaCard: {
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  areaEyebrow: { ...type.micro, marginBottom: 12 },
  areaRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 12,
  },
  areaRank: { width: 18, fontSize: 13, fontWeight: "800", color: colors.mute },
  areaLabel: { fontSize: 14, fontWeight: "700", color: colors.ink },
  barTrack: {
    marginTop: 6,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.faint,
    overflow: "hidden",
  },
  barFill: { height: "100%", backgroundColor: colors.red },
  areaPct: { fontSize: 13, fontWeight: "800", color: colors.red, minWidth: 34, textAlign: "right" },
});
