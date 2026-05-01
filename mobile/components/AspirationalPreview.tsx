import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { computeAspirationalPalate, type AspirationalPalate } from "../lib/aspirational-palate";

// ============================================================================
// AspirationalPreview — Home tab card surfacing the "Your Next Era" insight
// so users see it without digging into the Insights screen.
// ============================================================================

export function AspirationalPreview() {
  const router = useRouter();
  const [data, setData] = useState<AspirationalPalate | null>(null);

  useEffect(() => {
    let alive = true;
    computeAspirationalPalate().then((d) => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!data) return null;

  return (
    <Pressable onPress={() => router.push("/insights")} style={styles.card}>
      <Text style={styles.eyebrow}>YOUR NEXT ERA</Text>
      <Text style={styles.insight}>{data.insight}</Text>
      {data.topAspirationTags.length > 0 && (
        <View style={styles.tagRow}>
          {data.topAspirationTags.slice(0, 3).map((t) => (
            <View key={t.tag} style={styles.tag}>
              <Text style={styles.tagText}>{t.tag.replace(/_/g, " ")}</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={styles.cta}>See full breakdown →</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: 22,
    backgroundColor: colors.ink,
  },
  eyebrow: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  insight: { color: "#fff", fontSize: 15, fontWeight: "700", lineHeight: 22, marginTop: 8 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  tag: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  tagText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  cta: { color: colors.red, fontSize: 12, fontWeight: "800", marginTop: 12, letterSpacing: 0.3 },
});
