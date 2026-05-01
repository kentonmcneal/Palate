import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, Alert, ScrollView, Share, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { generateForCurrentWeek, latestWrapped, type Wrapped } from "../../lib/wrapped";
import { WrappedCard } from "../../components/WrappedCard";
import { WeeklyPalateInsights } from "../../components/WeeklyPalateInsights";
import { WrappedCharts } from "../../components/WrappedCharts";
import { Confetti } from "../../components/Confetti";
import { shareWrappedToFeed } from "../../lib/feed";
import ViewShot, { captureRef } from "react-native-view-shot";

export default function WrappedTab() {
  const [data, setData] = useState<Wrapped | null>(null);
  const [loading, setLoading] = useState(false);
  const [confettiKey, setConfettiKey] = useState(0);
  const cardRef = useRef<View>(null);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const latest = await latestWrapped();
      setData(latest);
    } catch (e: any) {
      console.warn("wrapped load", e?.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function generate() {
    setLoading(true);
    try {
      const w = await generateForCurrentWeek();
      if (!w) {
        Alert.alert(
          "Nothing yet",
          "Add a visit or two this week and try again — we'll generate your Wrapped.",
        );
      } else {
        const wasFirstReveal = !data;
        setData(w);
        // Celebrate the moment — bigger burst on the first-ever Wrapped reveal.
        setConfettiKey((k) => k + 1);
        void wasFirstReveal;
      }
    } catch (e: any) {
      Alert.alert("Couldn't generate", e.message ?? "Try again");
    } finally {
      setLoading(false);
    }
  }

  async function share() {
    if (!cardRef.current) return;
    try {
      const uri = await captureRef(cardRef, { format: "png", quality: 1 });
      await Share.share({ url: uri, message: "My Palate Wrapped" });
    } catch (e: any) {
      Alert.alert("Couldn't share", e.message ?? "Try again");
    }
  }

  async function shareToFeed() {
    if (!data) return;
    try {
      await shareWrappedToFeed({
        personaLabel: data.personality_label ?? "Your Palate",
        tagline: data.wrapped_json?.personality_label ?? "",
        weekStart: data.week_start,
        weekEnd: data.week_end,
        totalVisits: data.total_visits,
        topRestaurant: data.top_restaurant,
      });
      Alert.alert("Posted to feed", "Your friends will see it in their Feed tab.");
    } catch (e: any) {
      Alert.alert("Couldn't post", e.message ?? "Try again");
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Confetti fire={confettiKey > 0} count={180} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={type.title}>Your Wrapped</Text>
            <Text style={[type.body, { color: colors.mute, marginTop: 4 }]}>
              What your week says about how you eat.
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/insights")}
            style={styles.insightsBtn}
            accessibilityLabel="Open detailed insights"
          >
            <Text style={styles.insightsBtnText}>Insights →</Text>
          </Pressable>
        </View>
        <Spacer size={20} />

        {data ? (
          <>
            <ViewShot ref={cardRef as any} options={{ format: "png", quality: 1 }}>
              <WrappedCard data={data} />
            </ViewShot>
            <WrappedCharts />
            <WeeklyPalateInsights weekStart={data.week_start} weekEnd={data.week_end} />
            <Spacer />
            <Button title="Post to Feed" onPress={shareToFeed} />
            <Spacer />
            <Button title="Share image" variant="ghost" onPress={share} />
            <Spacer />
            <Button title="Refresh" variant="ghost" onPress={generate} loading={loading} />
          </>
        ) : (
          <>
            <Text style={[type.micro, { marginBottom: 10 }]}>PREVIEW · what your Sunday will look like</Text>
            <View style={{ opacity: 0.55 }} pointerEvents="none">
              <WrappedCard data={SAMPLE_WRAPPED} />
            </View>
            <Spacer />
            <View style={styles.empty}>
              <Text style={type.subtitle}>No Wrapped yet</Text>
              <Text style={[type.body, { color: colors.mute, marginTop: 6 }]}>
                Add a few visits this week, then tap below to generate yours.
              </Text>
              <Spacer />
              <Button title={loading ? "Generating…" : "Generate now"} onPress={generate} loading={loading} />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const SAMPLE_WRAPPED: Wrapped = {
  id: "sample",
  user_id: "sample",
  week_start: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
  week_end: new Date().toISOString().slice(0, 10),
  total_visits: 12,
  unique_restaurants: 7,
  top_restaurant: "Sweetgreen",
  top_category: "fast_casual",
  repeat_rate: 0.42,
  personality_label: "The Fast Casual Regular",
  wrapped_json: {
    total_visits: 12,
    unique_restaurants: 7,
    top_restaurant: "Sweetgreen",
    top_category: "fast_casual",
    repeat_rate: 0.42,
    personality_label: "The Fast Casual Regular",
    top_three: [
      { name: "Sweetgreen", count: 4 },
      { name: "Joe & The Juice", count: 2 },
      { name: "Joe's Pizza", count: 2 },
    ],
  },
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { padding: spacing.lg, paddingBottom: 100 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  insightsBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  insightsBtnText: { fontSize: 13, fontWeight: "700", color: colors.ink },
  empty: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
});
