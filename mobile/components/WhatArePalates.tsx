import { Pressable, View, Text, StyleSheet } from "react-native";
import { colors, spacing, type } from "../theme";
import { PalateAxisGraph } from "./PalateAxisGraph";
import { IDENTITY_BLURB, WHAT_ARE_PALATES, type PalateProfile, type PrimaryIdentity } from "../lib/palate";

// ============================================================================
// WhatArePalates — explainer block. Renders below Wrapped.
// Sections (per redesign brief):
//   1. Short explanation
//   2. 2x2 axis graph with user position highlighted
//   3. Short paragraph per quadrant
//   4. Tag explanation
//   5. Share CTA
// ============================================================================

const QUADRANT_ORDER: PrimaryIdentity[] = ["Curator", "Forager", "Steward", "Anchor"];

export function WhatArePalates({ profile, onShare }: { profile: PalateProfile; onShare?: () => void }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>WHAT ARE PALATES?</Text>
      <Text style={styles.intro}>{WHAT_ARE_PALATES.intro}</Text>

      <PalateAxisGraph profile={profile} />

      <View style={styles.quadrants}>
        {QUADRANT_ORDER.map((id) => {
          const isUser = profile.primaryIdentity === id;
          const blurb = IDENTITY_BLURB[id];
          return (
            <View key={id} style={[styles.quadrantBlock, isUser && styles.quadrantBlockActive]}>
              <Text style={[styles.qName, isUser && styles.qNameActive]}>{id}</Text>
              <Text style={styles.qTagline}>{blurb.tagline}</Text>
              <Text style={styles.qDesc}>{blurb.description}</Text>
            </View>
          );
        })}
      </View>

      <Text style={styles.eyebrow}>TAGS</Text>
      <Text style={styles.tagIntro}>{WHAT_ARE_PALATES.tagsIntro}</Text>

      {onShare && profile.primaryIdentity !== "Learning" && (
        <Pressable onPress={onShare} style={styles.shareBtn} accessibilityRole="button">
          <Text style={styles.shareBtnText}>Share your Palate →</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: 22,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.line,
  },
  eyebrow: { ...type.micro, color: colors.red, marginTop: spacing.md },
  intro: { fontSize: 14, color: colors.ink, lineHeight: 21, marginTop: 8 },
  tagIntro: { fontSize: 13, color: colors.mute, lineHeight: 19, marginTop: 8 },

  quadrants: {
    marginTop: spacing.md,
    gap: 10,
  },
  quadrantBlock: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  quadrantBlockActive: {
    backgroundColor: "#FFF1EE",
    borderColor: colors.red,
  },
  qName: { fontSize: 15, fontWeight: "800", color: colors.ink, letterSpacing: -0.2 },
  qNameActive: { color: colors.red },
  qTagline: { fontSize: 13, color: colors.ink, fontWeight: "600", marginTop: 4 },
  qDesc: { fontSize: 12, color: colors.mute, marginTop: 4, lineHeight: 17 },

  shareBtn: {
    marginTop: spacing.lg,
    alignSelf: "flex-start",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: colors.ink,
  },
  shareBtnText: { color: "#fff", fontSize: 14, fontWeight: "800", letterSpacing: 0.2 },
});
