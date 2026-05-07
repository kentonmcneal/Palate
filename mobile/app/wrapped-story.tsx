import { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Dimensions, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, spacing, type } from "../theme";
import { computeTasteVector, type TasteVector } from "../lib/taste-vector";
import {
  getProfileFromVector, IDENTITY_BLURB, vectorToWeeklyData, composeEgoHook,
  composeNextEra, type PalateProfile, type UserWeeklyData,
} from "../lib/palate";
import { isoWeekStart } from "../lib/wrapped";
import { triggerHapticSelection } from "../lib/haptics";
import { palateGradients, palateColors } from "../lib/theme/palateTheme";
import { myTopLovedItems, type LovedItem } from "../lib/menu-items";
import { generateCohortInsightAsync, type CohortInsight } from "../lib/population-stats";
import { generateIdentitySet } from "../lib/palate-labels";

// ============================================================================
// Wrapped Story — Spotify-Wrapped-style identity reveal in up to 5 cards.
// ----------------------------------------------------------------------------
// Now the EXCLUSIVE home for the deep narrative pieces (identity, signals,
// behavior, percentile/ego hook, top dish, cohort, next era). The Wrapped
// tab keeps only the share card, charts, area palates, and What Are Palates.
//
// Cards (in order):
//   1. Identity Reveal     — "FORAGER" + tagline
//   2. The Numbers         — "10 new places." + secondary stats
//   3. Why You Moved       — ego hook + interpretation + movement
//   4. Signals + Top Dish  — dominant tag + sub tags + top dish
//   5. Your Next Era       — composeNextEra + cohort line
//
// Cards 4 and 5 are skipped when their data isn't strong enough — the story
// tightens to 3 cards rather than padding with empty UI.
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
  /** Optional small line ABOVE the body — used for the dominant tag on Card 3. */
  dominantSubline?: string;
  body: string;
  /** Optional footer line — used for top dish on Card 4 ("♥ Coffee · Starbucks"). */
  footer?: string;
  /** When true, headline gets the display-grade font + brand-red glow. */
  hero?: boolean;
  gradient: [string, string] | [string, string, string];
};

export default function WrappedStoryScreen() {
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
      // Pull every piece of data the story needs in parallel.
      const weekVec = await computeTasteVector({ sinceDays: 7 }).catch(() => null);
      const profile = weekVec ? await getProfileFromVector(weekVec).catch(() => null) : null;
      const weekly = weekVec ? vectorToWeeklyData(weekVec) : null;

      const [topDish, cohort] = await Promise.all([
        myTopLovedItems(1, 7).then((items) => items[0] ?? null).catch(() => null),
        loadCohortInsight(weekVec, profile).catch(() => null),
      ]);

      // Top dish has a sensible all-time fallback: if the user rated zero
      // items this week, pull their loudest all-time love instead.
      let dish = topDish;
      if (!dish) {
        dish = await myTopLovedItems(1).then((items) => items[0] ?? null).catch(() => null);
      }

      if (alive) setCards(buildCards(profile, weekly, dish, cohort));
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
            numberOfLines={card.hero ? 2 : 4}
            adjustsFontSizeToFit
            minimumFontScale={0.55}
          >
            {card.headline}
          </Text>
          {card.dominantSubline && (
            <Text style={styles.dominantSubline}>{card.dominantSubline}</Text>
          )}
          <Text style={styles.cardBody}>{card.body}</Text>
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
// Card builder — up to 5 cards. Skips cards whose data isn't strong enough,
// so a quiet week gets a tighter story.
// ----------------------------------------------------------------------------
function buildCards(
  profile: PalateProfile | null,
  weekly: UserWeeklyData | null,
  topDish: LovedItem | null,
  cohort: CohortInsight | null,
): StoryCard[] {
  const id = profile?.primaryIdentity ?? "Learning";

  // Card 1 — Identity reveal -------------------------------------------------
  const card1: StoryCard = id === "Learning"
    ? {
        eyebrow: "YOUR PALATE THIS WEEK",
        headline: "Learning",
        body: "Log a few more visits and your Palate will surface.",
        gradient: palateGradients.storyDark,
        hero: true,
      }
    : {
        eyebrow: "YOUR PALATE THIS WEEK",
        headline: id,
        body: IDENTITY_BLURB[id].tagline,
        gradient: palateGradients.storyRed,
        hero: true,
      };

  const cards: StoryCard[] = [card1];

  // Card 2 — The numbers (Spotify-Wrapped style hero number) ----------------
  const numbers = composeNumbersCard(weekly);
  if (numbers) cards.push(numbers);

  // Card 3 — Why you moved (interpretation + ego hook) ---------------------
  if (profile && id !== "Learning") {
    const ego = composeEgoHook(profile);
    cards.push({
      eyebrow: ego ? ego.toUpperCase().replace(/\.$/, "") : "HOW YOU MOVED",
      headline: pickWhyHeadline(profile),
      body: composeWhyBody(profile),
      gradient: palateGradients.storyDark,
    });
  }

  // Card 4 — Signals + top dish --------------------------------------------
  const signals = composeSignalsCard(profile, topDish);
  if (signals) cards.push(signals);

  // Card 5 — Your next era (cohort + movement) -----------------------------
  if (profile && id !== "Learning") {
    cards.push({
      eyebrow: "YOUR NEXT ERA",
      headline: composeNextEra(id, profile.movement),
      body: composeNextEraBody(cohort),
      gradient: palateGradients.storyDark,
    });
  }

  // Belt-and-suspenders: never exceed 5.
  return cards.slice(0, 5);
}

// ----------------------------------------------------------------------------
// Card composers
// ----------------------------------------------------------------------------

function composeNumbersCard(d: UserWeeklyData | null): StoryCard | null {
  if (!d || d.totalVisits === 0) return null;

  const newCount = Math.round(d.totalVisits * d.newPlaceRate);

  // Headline — dominant numeric reveal. Prefer "all new" framing when it
  // actually applies, then fall back to plain visit count.
  let headline: string;
  if (newCount === d.totalVisits && d.totalVisits >= 4) {
    headline = `${d.totalVisits} visits.\n${d.totalVisits} new places.`;
  } else if (newCount >= d.totalVisits * 0.7 && newCount >= 3) {
    headline = `${newCount} new places.`;
  } else if (d.totalVisits >= 4) {
    headline = `${d.totalVisits} visits this week.`;
  } else {
    headline = `${d.totalVisits} visit${d.totalVisits === 1 ? "" : "s"}.`;
  }

  // Body — secondary stats joined into a quick one-liner.
  const bodyParts: string[] = [];
  if (d.neighborhoodCount >= 3) bodyParts.push(`Across ${d.neighborhoodCount} neighborhoods.`);
  if (d.cuisineDiversity >= 0.6) bodyParts.push("A wide cuisine spread.");
  else if (d.cuisineDiversity <= 0.25 && d.totalVisits >= 4) bodyParts.push("One or two cuisines, deeply.");
  if (d.repeatRate >= 0.5) bodyParts.push("And a steady rotation.");
  if (bodyParts.length === 0 && d.neighborhoodCount >= 1) bodyParts.push(`Across ${d.neighborhoodCount} neighborhood${d.neighborhoodCount === 1 ? "" : "s"}.`);

  return {
    eyebrow: "YOUR WEEK, IN NUMBERS",
    headline,
    body: bodyParts.join(" "),
    gradient: palateGradients.storyDark,
  };
}

function composeWhyBody(profile: PalateProfile): string {
  // Combine first behavior signal + movement summary into a single emotional
  // beat. Falls back gracefully when one is missing.
  const sig = profile.behaviorSignals[0] ?? "";
  const move = profile.movement?.summary ?? "";
  if (sig && move) return `${sig} ${move}`;
  return sig || move || profile.explanation;
}

function composeSignalsCard(profile: PalateProfile | null, topDish: LovedItem | null): StoryCard | null {
  if (!profile || profile.primaryIdentity === "Learning") return null;
  const tags = profile.tags;
  if (tags.length === 0 && !topDish) return null;

  const dominant = tags[0];
  const subTags = tags.slice(1, 4);
  const headline = dominant ?? "Steady week";
  const body = subTags.length > 0
    ? subTags.join(" · ")
    : topDish
      ? "And one dish carried it."
      : "Your Palate showed up quietly.";
  const footer = topDish ? `♥ ${topDish.itemName} · ${topDish.restaurantName}` : undefined;

  return {
    eyebrow: "THIS WEEK'S SIGNALS",
    headline,
    body,
    footer,
    gradient: palateGradients.storyRed,
    hero: true,
  };
}

function composeNextEraBody(cohort: CohortInsight | null): string {
  if (!cohort) return "Keep eating like you. Your Palate will keep moving.";
  // Trim cohort lines into one editorial sentence — never the full bullet list.
  return `${cohort.countLine}. ${cohort.paceLine}.`;
}

/** Picks a short, observational WHY headline from the profile. */
function pickWhyHeadline(profile: PalateProfile): string {
  const id = profile.primaryIdentity;
  const novelty = profile.noveltyScore;
  const premium = profile.premiumScore;

  if (id === "Forager") return novelty >= 0.75 ? "You chased variety." : "You explored.";
  if (id === "Curator") return "You picked carefully.";
  if (id === "Steward") return premium >= 0.65 ? "You returned to the right places." : "You stuck with what works.";
  if (id === "Anchor") return "You leaned on the trusted few.";
  return "Your pattern took shape.";
}

// ----------------------------------------------------------------------------
// Cohort loader — uses the legacy palate-labels system to build the input the
// population-stats helper expects. Wraps the whole thing in a try so a failure
// here just drops Card 5's body to the fallback line.
// ----------------------------------------------------------------------------
async function loadCohortInsight(
  weekVec: TasteVector | null,
  profile: PalateProfile | null,
): Promise<CohortInsight | null> {
  if (!weekVec || !profile || profile.primaryIdentity === "Learning") return null;
  const allTime = await computeTasteVector().catch(() => null);
  if (!allTime) return null;
  const ids = generateIdentitySet(allTime, weekVec);
  return generateCohortInsightAsync(ids.primary, allTime).catch(() => null);
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
    color: palateColors.red,
    textShadowColor: "rgba(255,45,22,0.32)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
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
