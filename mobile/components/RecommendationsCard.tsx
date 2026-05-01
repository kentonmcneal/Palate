import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, Linking, Platform } from "react-native";
import { colors, spacing, type } from "../theme";
import { isoWeekStart } from "../lib/wrapped";
import {
  generateWeeklyPalatePersona,
  getPersonaRecommendations,
} from "../lib/palate-persona";
import {
  addToWishlist,
  type RestaurantRecommendation,
} from "../lib/palate-insights";

// ============================================================================
// RecommendationsCard — always-visible spot suggestions on the Home tab.
// ----------------------------------------------------------------------------
// Time-of-day aware via the headline copy (morning -> "for your morning",
// midday -> "for lunch", evening -> "for tonight"). Pulls 2 personas-driven
// picks for fast scanning. Each row is tappable to save to wishlist.
// ============================================================================

function timeOfDay(now = new Date()): "morning" | "midday" | "evening" {
  const h = now.getHours();
  if (h < 11) return "morning";
  if (h < 17) return "midday";
  return "evening";
}

const HEADLINES = {
  morning: "Spots for your morning",
  midday:  "Lunch picks for you",
  evening: "Dinner picks for you",
};

const BLURBS = {
  morning: "Cafés and quick-stops your Palate would gravitate toward.",
  midday:  "Bowls, counter service, and the quick-but-good lane.",
  evening: "Where your Palate likes to land at the end of a day.",
};

export function RecommendationsCard() {
  const [recs, setRecs] = useState<RestaurantRecommendation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const tod = timeOfDay();

  const load = useCallback(async () => {
    try {
      const start = isoWeekStart();
      const end = new Date().toISOString().slice(0, 10);
      const persona = await generateWeeklyPalatePersona(start, end);
      if (!persona) {
        setRecs([]);
        return;
      }
      const result = await getPersonaRecommendations(persona, start, end);
      const all = [...(result.similar ?? [])];
      if (result.stretch) all.push(result.stretch);
      setRecs(all.slice(0, 2));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Hide the card entirely until we know if we have anything to show — keeps
  // the Home tab from flashing a useless block on first load.
  if (loading) return null;
  if (error || !recs || recs.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>RECOMMENDED</Text>
          <Text style={styles.title}>{HEADLINES[tod]}</Text>
          <Text style={styles.blurb}>{BLURBS[tod]}</Text>
        </View>
      </View>
      <View style={{ marginTop: 16 }}>
        {recs.map((rec) => (
          <RecRow key={rec.google_place_id} rec={rec} />
        ))}
      </View>
    </View>
  );
}

function RecRow({ rec }: { rec: RestaurantRecommendation }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (saved || saving) return;
    setSaving(true);
    try {
      await addToWishlist(rec.google_place_id);
      setSaved(true);
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "Try again");
    } finally {
      setSaving(false);
    }
  }

  function openInMaps() {
    const url = mapsUrlFor(rec.name, rec.neighborhood ?? "");
    Linking.openURL(url).catch(() => {
      Alert.alert("Couldn't open Maps", "Try searching for it directly in Maps.");
    });
  }

  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{rec.name}</Text>
        <Text style={styles.sub}>
          {[rec.cuisine ? capitalize(rec.cuisine) : null, rec.neighborhood]
            .filter(Boolean)
            .join(" · ") || "Nearby"}
        </Text>
        <Text style={styles.reason}>{rec.reason}</Text>
        <Pressable onPress={openInMaps} style={styles.mapsLink} accessibilityRole="link">
          <Text style={styles.mapsLinkText}>Open in Maps →</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={save}
        style={[styles.saveBtn, saved && styles.saveBtnDone]}
        accessibilityRole="button"
      >
        <Text style={[styles.saveText, saved && styles.saveTextDone]}>
          {saving ? "…" : saved ? "Saved" : "Save"}
        </Text>
      </Pressable>
    </View>
  );
}

function mapsUrlFor(name: string, address: string): string {
  const query = encodeURIComponent(address ? `${name}, ${address}` : name);
  if (Platform.OS === "ios") {
    return `maps://?q=${query}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: 22,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  head: { flexDirection: "row" },
  eyebrow: { ...type.micro },
  title: { fontSize: 18, fontWeight: "700", color: colors.ink, marginTop: 6, letterSpacing: -0.3 },
  blurb: { ...type.small, marginTop: 4 },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    gap: 12,
  },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
  sub: { ...type.small, marginTop: 2 },
  reason: { fontSize: 13, color: colors.mute, marginTop: 6, fontStyle: "italic", lineHeight: 18 },

  mapsLink: {
    marginTop: 8,
    alignSelf: "flex-start",
  },
  mapsLinkText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.red,
    letterSpacing: 0.3,
  },

  saveBtn: {
    paddingHorizontal: 14, height: 32, borderRadius: 16,
    backgroundColor: colors.red,
    alignItems: "center", justifyContent: "center",
  },
  saveBtnDone: {
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  saveText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  saveTextDone: { color: colors.mute },
});
