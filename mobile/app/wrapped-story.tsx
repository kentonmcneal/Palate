import { useState, useEffect, useRef } from "react";
import { View, StyleSheet, Pressable, Dimensions, Animated, Easing } from "react-native";
import { Text } from "../components/Text";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, spacing, type } from "../theme";
import { computeTasteVector } from "../lib/taste-vector";
import {
  getProfileFromVector, IDENTITY_BLURB, vectorToWeeklyData,
  type PalateProfile, type UserWeeklyData,
} from "../lib/palate";
import { identityName, identityTitle } from "../lib/palate";
import {
  composeLearningLine, composeNextEra, composeStoryAlso, composeStoryNumbers, composeStoryStandout,
} from "../lib/palate/palateCopy";
import { isoWeekStart } from "../lib/wrapped";
import { triggerHapticSelection } from "../lib/haptics";
import { palateGradients, palateColors } from "../lib/theme/palateTheme";
import { myTopLovedItems, type LovedItem } from "../lib/menu-items";
import { useFontScale } from "../lib/a11y";

// ============================================================================
// Wrapped Story — Spotify-Wrapped-style identity reveal in up to 5 cards.
// ----------------------------------------------------------------------------
// The EXCLUSIVE home for the narrative pieces. The Wrapped tab keeps only the
// share card, charts, and What Are Palates.
//
// Every card says one plain thing, with a number where there is one, in at
// most two short sentences. The words live in lib/palate/palateCopy.ts so
// they are pure and tested; this file only decides which cards to show.
//
// Cards (in order):
//   1. Your Palate this week  — the badge ("The Explorer") + what it means
//   2. Your week in numbers   — "6 visits." + places, neighborhoods, cuisines
//   3. What stood out         — "4 of 6 visits were somewhere new." + vs last week
//   4. Also this week         — the details as plain phrases + the dish you loved
//   5. If this keeps up       — the identity the week's shift points at, + meaning
//
// Cards 2, 4 and 5 are skipped when they have nothing to say: the story
// tightens rather than padding with a sentence that restates the last card.
//
// The cohort line ("1,050 Palates eat like you. They average 3.4 eating-out
// meals a week.") used to close card 5. It was preview data, generated from
// a hash of the identity label, shown to a real person as a statistic. The
// founder pulled "Top Palates in <city>" off the tab on 2026-09-05 for the
// same reason, so it is gone from here too; population-stats still has the
// real-data path if the user count ever earns it back.
//
// Shown the first time per ISO week the user opens Wrapped (gated via
// AsyncStorage key 'palate.wrappedStory.lastShownWeek').
// ============================================================================

export const STORY_LAST_SHOWN_KEY = "palate.wrappedStory.lastShownWeek";

const { width: W } = Dimensions.get("window");

type StoryCard = {
  eyebrow: string;
  /** Headline gets the display-size treatment. */
  headline: string;
  /** Optional small line ABOVE the body. */
  dominantSubline?: string;
  body: string;
  /** Optional footer line — used for the dish on card 4 ("♥ Coffee · Starbucks"). */
  footer?: string;
  /** When true, headline gets the display-grade font + brand-red glow. */
  hero?: boolean;
  gradient: [string, string] | [string, string, string];
};

export default function WrappedStoryScreen() {
  const { stack } = useFontScale();
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [cards, setCards] = useState<StoryCard[]>([]);
  const fade = useState(new Animated.Value(1))[0];
  // Reveal motion — fade in + 8px slide up on each new card.
  const reveal = useState(new Animated.Value(0))[0];

  useEffect(() => {
    reveal.setValue(0);
    Animated.timing(reveal, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [index, cards.length]);

  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const weekVec = await computeTasteVector({ sinceDays: 7 }).catch(() => null);
      const profile = weekVec ? await getProfileFromVector(weekVec).catch(() => null) : null;
      const weekly = weekVec ? vectorToWeeklyData(weekVec) : null;

      // Top dish has a sensible all-time fallback: if the user rated zero
      // items this week, pull their loudest all-time love instead.
      let dish = await myTopLovedItems(1, 7).then((items) => items[0] ?? null).catch(() => null);
      if (!dish) {
        dish = await myTopLovedItems(1).then((items) => items[0] ?? null).catch(() => null);
      }

      if (alive) setCards(buildCards(profile, weekly, weekVec?.uniqueRestaurants ?? null, dish));
    })();
    return () => {
      alive = false;
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);

  function next() {
    void triggerHapticSelection();
    if (index >= cards.length - 1) {
      void AsyncStorage.setItem(STORY_LAST_SHOWN_KEY, isoWeekStart()).catch(() => {});
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/wrapped");
      return;
    }
    Animated.sequence([
      Animated.timing(fade, { toValue: 0, duration: 160, useNativeDriver: true, easing: Easing.in(Easing.quad) }),
      Animated.timing(fade, { toValue: 1, duration: 240, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
    ]).start();
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => setIndex((i) => i + 1), 160);
  }

  function skip() {
    void AsyncStorage.setItem(STORY_LAST_SHOWN_KEY, isoWeekStart()).catch(() => {});
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/wrapped");
  }

  if (cards.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><Text style={[type.body, { color: "rgba(255,255,255,0.6)" }]}>Loading…</Text></View>
      </SafeAreaView>
    );
  }

  const card = cards[index];

  return (
    <Pressable style={styles.safe} onPress={next}>
      <LinearGradient
        colors={card.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={{ flex: 1 }}>
        {/* Progress bars at top */}
        <View style={styles.progressRow}>
          {cards.map((_, i) => (
            <View key={i} style={[styles.progressTrack, i === index && styles.progressTrackActive]}>
              {i < index && <View style={styles.progressFillDone} />}
              {i === index && <View style={styles.progressFillActive} />}
            </View>
          ))}
        </View>

        {/* Skip */}
        <Pressable style={styles.skipBtn} onPress={(e) => { e.stopPropagation(); skip(); }}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>

        <Animated.View
          style={[
            styles.body,
            {
              opacity: Animated.multiply(fade, reveal),
              transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
            },
          ]}
        >
          <Text style={styles.eyebrow}>{card.eyebrow}</Text>
          <Text
            style={[styles.headline, card.hero && styles.headlineHero]}
            numberOfLines={stack ? (card.hero ? 3 : 6) : card.hero ? 2 : 4}
            adjustsFontSizeToFit
            minimumFontScale={0.55}
          >
            {card.headline}
          </Text>
          {card.dominantSubline && (
            <Text style={styles.dominantSubline}>{card.dominantSubline}</Text>
          )}
          {card.body.length > 0 && (
            <Text style={styles.cardBody}>{card.body}</Text>
          )}
          {card.footer && (
            <Text style={styles.footerLine}>{card.footer}</Text>
          )}
        </Animated.View>

        <View style={styles.footer}>
          <Text style={styles.tapHint}>{index < cards.length - 1 ? "Tap to continue" : "Tap to see your Wrapped"}</Text>
        </View>
      </SafeAreaView>
    </Pressable>
  );
}

// ----------------------------------------------------------------------------
// Card builder — up to 5 cards. Skips cards with nothing to say, so a quiet
// week gets a tighter story.
// ----------------------------------------------------------------------------
function buildCards(
  profile: PalateProfile | null,
  weekly: UserWeeklyData | null,
  uniquePlaces: number | null,
  topDish: LovedItem | null,
): StoryCard[] {
  const id = profile?.primaryIdentity ?? "Learning";

  // Card 1 — the badge, with what it means on the same card. A week too thin
  // to name says the number it has and the number it needs.
  const card1: StoryCard = id === "Learning"
    ? {
        eyebrow: "YOUR PALATE THIS WEEK",
        headline: identityName("Learning"),
        body: composeLearningLine(weekly?.totalVisits ?? 0),
        gradient: palateGradients.storyDark,
        hero: true,
      }
    : {
        eyebrow: "YOUR PALATE THIS WEEK",
        headline: identityTitle(id),
        body: IDENTITY_BLURB[id].tagline,
        gradient: palateGradients.storyRed,
        hero: true,
      };

  const cards: StoryCard[] = [card1];

  // Card 2 — the week in numbers.
  const numbers = composeStoryNumbers(weekly, uniquePlaces);
  if (numbers) {
    cards.push({ eyebrow: "YOUR WEEK IN NUMBERS", ...numbers, gradient: palateGradients.storyDark });
  }

  if (profile && id !== "Learning") {
    // Card 3 — the one thing that stood out, and how it compares to last week.
    cards.push({ eyebrow: "WHAT STOOD OUT", ...composeStoryStandout(profile), gradient: palateGradients.storyDark });

    // Card 4 — the details, as plain phrases, and the dish they loved.
    const also = composeStoryAlso(profile.tags, topDish);
    if (also) {
      cards.push({ eyebrow: "ALSO THIS WEEK", ...also, gradient: palateGradients.storyRed, hero: true });
    }

    // Card 5 — the identity this week's shift points at, only when it is a
    // different one from card 1. Same treatment as card 1: badge + meaning.
    const next = composeNextEra(id, profile.movement);
    if (next) {
      cards.push({ eyebrow: "IF THIS KEEPS UP", ...next, gradient: palateGradients.storyRed, hero: true });
    }
  }

  // Belt-and-suspenders: never exceed 5.
  return cards.slice(0, 5);
}

// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  progressRow: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  progressTrack: {
    flex: 1, height: 3, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.18)",
    overflow: "hidden",
  },
  progressTrackActive: { backgroundColor: "rgba(255,255,255,0.18)" },
  progressFillDone: { flex: 1, backgroundColor: "rgba(255,255,255,0.9)" },
  progressFillActive: { flex: 0.5, backgroundColor: "rgba(255,255,255,0.9)" },

  skipBtn: {
    alignSelf: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  skipText: { color: "rgba(255,255,255,0.65)", fontSize: 13, fontWeight: "700" },

  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
  },
  eyebrow: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 12, fontWeight: "800", letterSpacing: 2.2,
  },
  headline: {
    color: "#fff",
    fontSize: 38, fontWeight: "800", letterSpacing: -0.7,
    lineHeight: 44,
    marginTop: 12,
  },
  headlineHero: {
    fontSize: 64, lineHeight: 68, letterSpacing: -1.4,
    // White, not red. Red text on the storyRed gradient (#5A0B14 at its
    // lightest) clears about 3.6:1 — technically legal for type this size and
    // genuinely hard to read, which the founder saw immediately in a
    // screenshot and I had not, because I have never looked at this screen.
    //
    // The glow stays red. The panel still reads as the red one, the word on it
    // is legible at a glance, and white on that gradient is over 13:1.
    color: "#fff",
    textShadowColor: "rgba(255,45,22,0.55)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 22,
  },
  dominantSubline: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 16, fontWeight: "600",
    marginTop: 12,
  },
  cardBody: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 18, lineHeight: 26,
    marginTop: 20,
    fontWeight: "500",
  },
  footerLine: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 14, lineHeight: 20,
    marginTop: 24,
    fontWeight: "600",
    letterSpacing: 0.2,
  },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    alignItems: "center",
  },
  tapHint: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "700", letterSpacing: 1 },
});
