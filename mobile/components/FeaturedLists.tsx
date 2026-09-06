import { useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { Text } from "./Text";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { colors, categoryColors, spacing, type, card } from "../theme";
import { buildFeaturedLists, type FeaturedList } from "../lib/featured-lists";
import type { TasteVector } from "../lib/taste-vector";
import type { PersonalSignal } from "../lib/personal-signal";

// ============================================================================
// FeaturedLists — Beli-style horizontal carousel of curated category lists.
// Each card is a colored cover (no photos in the catalog yet) with title +
// "X of N" progress. Tapping opens the full list at /featured-list/[slug].
// ============================================================================

type Props = {
  here: { lat: number; lng: number } | null;
  city?: string | null;
  vector?: TasteVector | null;
  personal?: PersonalSignal | null;
};

export function FeaturedLists({ here, city, vector, personal }: Props) {
  const router = useRouter();
  const [lists, setLists] = useState<FeaturedList[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!here) return;
    let alive = true;
    buildFeaturedLists({ here, city, vector, personal }).then((l) => {
      if (!alive) return;
      setLists(l);
      setLoaded(true);
    }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [here?.lat, here?.lng, city, vector, personal]);

  if (!loaded || lists.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        {/* A saffron mark before the eyebrow. The question above carries a
            terracotta bar; this row is the city's answers to it, and a second
            warm accent ties the two together without adding a third heading. */}
        <View style={styles.headDot} />
        <Text style={type.micro}>FEATURED LISTS</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {lists.map((l) => (
          <Pressable
            key={l.slug}
            style={styles.card}
            onPress={() => router.push({
              pathname: "/featured-list/[slug]",
              params: { slug: l.slug },
            })}
          >
            <LinearGradient
              colors={l.gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            {/* Subtle glyph badge in the corner */}
            <View style={styles.glyphBadge}>
              <Text style={styles.glyphText}>{l.iconGlyph}</Text>
            </View>
            <View style={styles.cardBottom}>
              <Text style={styles.title} numberOfLines={2}>{l.title}</Text>
              <Text style={styles.sub}>{l.subtitle}</Text>
              <View style={styles.progressRow}>
                {/* The count is the fact; the words around it are grammar. It
                    goes full white and heavy, the sentence stays a step back. */}
                <Text style={styles.progress}>
                  You've been to <Text style={styles.progressCount}>{l.visitedCount}</Text> of {l.totalCount}
                </Text>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const CARD_W = 240;
const CARD_H = 170;

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg },
  head: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 10 },
  headDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: categoryColors.saffron },
  scroll: { gap: 12, paddingRight: spacing.lg },

  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: card.radius,
    overflow: "hidden",
    justifyContent: "flex-end",
    padding: 14,
    backgroundColor: colors.ink,
  },
  glyphBadge: {
    position: "absolute", top: 12, right: 12,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center",
  },
  glyphText: { color: "#fff", fontWeight: "800", fontSize: 13, letterSpacing: -0.3 },

  cardBottom: { gap: 4 },
  title: { color: "#fff", fontSize: 18, fontWeight: "800", letterSpacing: -0.3, lineHeight: 22 },
  sub: { color: "rgba(255,255,255,0.72)", fontSize: 13, fontWeight: "600" },
  progressRow: { marginTop: 8 },
  progress: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "700" },
  progressCount: { color: "#fff", fontWeight: "800", fontSize: 13 },
});
