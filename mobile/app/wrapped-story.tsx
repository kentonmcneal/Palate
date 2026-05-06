import { useState, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, Dimensions, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, spacing, type } from "../theme";
import { computeTasteVector } from "../lib/taste-vector";
import { getProfileFromVector, IDENTITY_BLURB, type PalateProfile } from "../lib/palate";
import { isoWeekStart } from "../lib/wrapped";
import { triggerHapticSelection } from "../lib/haptics";

// ============================================================================
// Wrapped Story — three quick cards before the Wrapped reveal.
// ----------------------------------------------------------------------------
// Tap-through narrative built from this week's vector. Reuses the user's
// own data so it never feels generic.
//
// Card 1: a behavioral observation
// Card 2: a contrast or pattern note
// Card 3: the "why this week" framing
// → tap-through ends with router.replace to /(tabs)/wrapped
//
// Shown the first time per ISO week the user opens Wrapped (gated via
// AsyncStorage key 'palate.wrappedStory.lastShownWeek').
// ============================================================================

export const STORY_LAST_SHOWN_KEY = "palate.wrappedStory.lastShownWeek";

const { width: W } = Dimensions.get("window");

type StoryCard = {
  eyebrow: string;
  headline: string;
  body: string;
  gradient: [string, string];
};

export default function WrappedStoryScreen() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [cards, setCards] = useState<StoryCard[]>([]);
  const fade = useState(new Animated.Value(1))[0];

  useEffect(() => {
    (async () => {
      const v = await computeTasteVector({ sinceDays: 7 }).catch(() => null);
      const profile = v ? await getProfileFromVector(v).catch(() => null) : null;
      setCards(buildCards(profile));
    })();
  }, []);

  function next() {
    void triggerHapticSelection();
    if (index >= cards.length - 1) {
      // Persist the last-shown week so we don't loop on every focus.
      void AsyncStorage.setItem(STORY_LAST_SHOWN_KEY, isoWeekStart()).catch(() => {});
      // dismiss() pops the modal stack and returns to the previously-mounted
      // Wrapped tab — does NOT remount it. Critical: replace() would remount
      // and re-trigger the focus effect, kicking off an infinite loop.
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/wrapped");
      return;
    }
    Animated.sequence([
      Animated.timing(fade, { toValue: 0, duration: 160, useNativeDriver: true, easing: Easing.in(Easing.quad) }),
      Animated.timing(fade, { toValue: 1, duration: 240, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
    ]).start();
    setTimeout(() => setIndex((i) => i + 1), 160);
  }

  function skip() {
    void AsyncStorage.setItem(STORY_LAST_SHOWN_KEY, isoWeekStart()).catch(() => {});
    // Same as next() at the end — back() preserves the existing Wrapped tab.
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

        <Animated.View style={[styles.body, { opacity: fade }]}>
          <Text style={styles.eyebrow}>{card.eyebrow}</Text>
          <Text style={styles.headline}>{card.headline}</Text>
          <Text style={styles.cardBody}>{card.body}</Text>
        </Animated.View>

        <View style={styles.footer}>
          <Text style={styles.tapHint}>{index < cards.length - 1 ? "Tap to continue" : "Tap to see your Wrapped"}</Text>
        </View>
      </SafeAreaView>
    </Pressable>
  );
}

// ----------------------------------------------------------------------------
// Card builder — three cards per spec:
//   Card 1: "Your palate leaned ___ this week"
//   Card 2: Behavior explanation
//   Card 3: Tags / movement
// ----------------------------------------------------------------------------
function buildCards(profile: PalateProfile | null): StoryCard[] {
  // Card 1 — identity reveal ("Your palate this week leaned X")
  const identityName = profile?.primaryIdentity ?? "Learning";
  const card1: StoryCard = identityName === "Learning"
    ? {
        eyebrow: "THIS WEEK",
        headline: "We're still learning your Palate.",
        body: "Log a few more visits and we'll show you who you eat like.",
        gradient: ["#1A1A1A", "#000000"],
      }
    : {
        eyebrow: "YOUR PALATE THIS WEEK LEANED",
        headline: identityName,
        body: IDENTITY_BLURB[identityName].tagline,
        gradient: ["#1A1A1A", "#000000"],
      };

  // Card 2 — behavior explanation (what your data showed)
  const card2: StoryCard = profile && profile.behaviorSignals.length > 0
    ? {
        eyebrow: "WHY",
        headline: profile.explanation,
        body: profile.behaviorSignals.slice(0, 2).join(" "),
        gradient: ["#3D1F1A", "#0F0604"],
      }
    : {
        eyebrow: "WHY",
        headline: "A quiet week.",
        body: "Some weeks the kitchen wins. We'll still surface what your pattern says.",
        gradient: ["#3D1F1A", "#0F0604"],
      };

  // Card 3 — tags + movement (where you went / where you're going)
  const tagsLine = profile && profile.tags.length > 0
    ? profile.tags.slice(0, 3).join(" · ")
    : "Tags appear after a few more visits.";
  const movement = profile?.movement?.summary ?? "Your Palate updates each week.";
  const card3: StoryCard = {
    eyebrow: "TAGS + MOVEMENT",
    headline: tagsLine,
    body: movement,
    gradient: ["#7A0B00", "#2B0400"],
  };

  return [card1, card2, card3];
}

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
    color: "rgba(255,255,255,0.55)",
    fontSize: 12, fontWeight: "700", letterSpacing: 2,
  },
  headline: {
    color: "#fff",
    fontSize: 36, fontWeight: "800", letterSpacing: -0.7,
    lineHeight: 42,
    marginTop: 12,
  },
  cardBody: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 18, lineHeight: 26,
    marginTop: 20,
    fontWeight: "500",
  },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    alignItems: "center",
  },
  tapHint: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "700", letterSpacing: 1 },
});
