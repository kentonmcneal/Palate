import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Linking, Platform, Alert } from "react-native";
import { colors, spacing, type } from "../theme";
import { supabase } from "../lib/supabase";

// ============================================================================
// SkipNudgeCard — surfaces a place the user has been *near* and dismissed
// 3+ times in the last 30 days. Soft nudge: "you've passed this 3 times,
// might be time to try it."
// ----------------------------------------------------------------------------
// Reads from the existing `prompt_decisions` table (outcome = 'dismissed' or
// 'wrong_place'), groups by google_place_id, picks the spot with the highest
// repeat count.
// ============================================================================

const LOOKBACK_DAYS = 30;
const MIN_PASSES = 3;

type Nudge = {
  google_place_id: string;
  passes: number;
  name: string;
  neighborhood: string | null;
};

export function SkipNudgeCard() {
  const [nudge, setNudge] = useState<Nudge | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("prompt_decisions")
        .select("google_place_id, outcome")
        .gte("decided_at", cutoff)
        .in("outcome", ["dismissed"]);
      if (!alive || error || !data?.length) return;

      // Tally passes per place_id
      const counts = new Map<string, number>();
      for (const row of data as Array<{ google_place_id: string }>) {
        counts.set(row.google_place_id, (counts.get(row.google_place_id) ?? 0) + 1);
      }
      const top = [...counts.entries()]
        .filter(([, n]) => n >= MIN_PASSES)
        .sort((a, b) => b[1] - a[1])[0];
      if (!top) return;

      const [placeId, passes] = top;
      const { data: rest } = await supabase
        .from("restaurants")
        .select("name, neighborhood")
        .eq("google_place_id", placeId)
        .maybeSingle();
      if (!alive || !rest) return;

      setNudge({
        google_place_id: placeId,
        passes,
        name: rest.name,
        neighborhood: rest.neighborhood as string | null,
      });
    })();
    return () => { alive = false; };
  }, []);

  if (!nudge) return null;

  function openInMaps() {
    const query = encodeURIComponent(nudge!.neighborhood ? `${nudge!.name}, ${nudge!.neighborhood}` : nudge!.name);
    const url = Platform.OS === "ios" ? `maps://?q=${query}` : `https://www.google.com/maps/search/?api=1&query=${query}`;
    Linking.openURL(url).catch(() => {
      Alert.alert("Couldn't open Maps", "Try searching for it directly in Maps.");
    });
  }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>YOU KEEP PASSING THIS</Text>
      <Text style={styles.name}>{nudge.name}</Text>
      <Text style={styles.body}>
        You've walked past this {nudge.passes} times in the last month{nudge.neighborhood ? ` in ${nudge.neighborhood}` : ""}.
        Maybe it's time?
      </Text>
      <View style={styles.row}>
        <Pressable onPress={openInMaps} style={styles.btn}>
          <Text style={styles.btnText}>Take me there</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.xl,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: "#FFF7F4",
    borderWidth: 1,
    borderColor: "#FFD7CE",
  },
  eyebrow: { ...type.micro, color: colors.red },
  name: { fontSize: 18, fontWeight: "800", color: colors.ink, marginTop: 6, letterSpacing: -0.4 },
  body: { fontSize: 13, color: colors.ink, marginTop: 6, lineHeight: 19 },
  row: { marginTop: 12, flexDirection: "row" },
  btn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.red,
  },
  btnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
