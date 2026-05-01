import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import { colors, spacing, type } from "../theme";
import { listWishlist } from "../lib/palate-insights";
import { supabase } from "../lib/supabase";
import { openInAppleMaps, openInGoogleMaps } from "../lib/maps";

// ============================================================================
// SwapNudgeCard — "You always end up at X instead."
// ----------------------------------------------------------------------------
// When the user has saved a spot in a cuisine where they ALSO have a known
// repeat-favorite, surface the contrast: "You saved Roberta's, but Joe's
// keeps winning your Tuesdays — try Roberta's this time?"
//
// Subtle, behavior-mirroring nudge. Only fires when there's a real pattern
// to mirror (3+ visits to the same spot in the same cuisine).
// ============================================================================

const MIN_REPEATS = 3;

type Nudge = {
  saved: { name: string; neighborhood: string | null; cuisine: string | null };
  goto: { name: string; visits: number };
};

export function SwapNudgeCard() {
  const [nudge, setNudge] = useState<Nudge | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const wishlist = await listWishlist();
        if (!alive || wishlist.length === 0) return;

        // For each saved cuisine, find the user's repeat-favorite restaurant
        // in the same cuisine.
        const candidate = await findSwap(wishlist);
        if (alive && candidate) setNudge(candidate);
      } catch {
        // silent
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!nudge) return null;

  function openApple() { openInAppleMaps(nudge!.saved.name, nudge!.saved.neighborhood); }
  function openGoogle() { openInGoogleMaps(nudge!.saved.name, nudge!.saved.neighborhood); }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>BEHAVIOR CHECK</Text>
      <Text style={styles.body}>
        You saved <Text style={styles.bold}>{nudge.saved.name}</Text> — but you always end up
        at <Text style={styles.bold}>{nudge.goto.name}</Text> ({nudge.goto.visits} visits).
        {" "}This week's the week?
      </Text>
      <View style={styles.row}>
        <Pressable onPress={openApple} style={styles.btn}>
          <Text style={styles.btnText}>Apple Maps</Text>
        </Pressable>
        <Pressable onPress={openGoogle} style={styles.btn}>
          <Text style={styles.btnText}>Google Maps</Text>
        </Pressable>
      </View>
    </View>
  );
}

async function findSwap(wishlist: Awaited<ReturnType<typeof listWishlist>>): Promise<Nudge | null> {
  // Group wishlist by cuisine; for each, look up the user's most-visited
  // restaurant in that cuisine. If repeat count >= threshold, that's our nudge.
  const byCuisine = new Map<string, typeof wishlist[number]>();
  for (const w of wishlist) {
    const c = w.restaurant?.cuisine_type;
    if (c && !byCuisine.has(c)) byCuisine.set(c, w);
  }

  for (const [cuisine, savedEntry] of byCuisine.entries()) {
    const goto = await topRestaurantInCuisine(cuisine);
    if (!goto || goto.visits < MIN_REPEATS) continue;
    if (goto.name.toLowerCase() === (savedEntry.restaurant?.name ?? "").toLowerCase()) continue;
    return {
      saved: {
        name: savedEntry.restaurant!.name,
        neighborhood: savedEntry.restaurant!.neighborhood,
        cuisine,
      },
      goto,
    };
  }
  return null;
}

async function topRestaurantInCuisine(cuisine: string): Promise<{ name: string; visits: number } | null> {
  const { data } = await supabase
    .from("visits")
    .select("restaurant:restaurants(name, cuisine_type)")
    .order("visited_at", { ascending: false })
    .limit(200);
  if (!data) return null;

  const counts = new Map<string, number>();
  for (const row of data as Array<{ restaurant: { name: string; cuisine_type: string | null } | { name: string; cuisine_type: string | null }[] | null }>) {
    const r = Array.isArray(row.restaurant) ? row.restaurant[0] : row.restaurant;
    if (!r || r.cuisine_type !== cuisine) continue;
    counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0] ? { name: sorted[0][0], visits: sorted[0][1] } : null;
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.xl,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  eyebrow: { ...type.micro, color: colors.red },
  body: { fontSize: 14, color: colors.ink, marginTop: 8, lineHeight: 20 },
  bold: { fontWeight: "800" },
  row: { flexDirection: "row", gap: 8, marginTop: 12 },
  btn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.line,
  },
  btnText: { fontSize: 12, fontWeight: "700", color: colors.ink },
});
