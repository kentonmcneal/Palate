import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { colors, spacing, type } from "../theme";
import { loadAnalytics, type AnalyticsSummary } from "../lib/analytics-stats";
import { DonutChart, type DonutSlice } from "./charts/DonutChart";
import { VerticalBars, type VBar } from "./charts/VerticalBars";

const CUISINE_PALETTE = [
  "#FF3008", "#FF6B45", "#FF9466", "#FFB68C", "#1F1F1F", "#555555", "#9A9A9A",
];

const CUISINE_LABELS: Record<string, string> = {
  italian: "Italian", mexican: "Mexican", japanese: "Japanese", chinese: "Chinese",
  thai: "Thai", indian: "Indian", vietnamese: "Vietnamese", korean: "Korean",
  mediterranean: "Mediterranean", "middle-eastern": "Middle Eastern",
  american: "American", bbq: "BBQ", seafood: "Seafood", steakhouse: "Steakhouse",
  bakery: "Bakery", dessert: "Dessert", "café": "Café", healthy: "Healthy",
  bar: "Bar", other: "Other",
};

const DOW_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export function WrappedCharts() {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusedSlice, setFocusedSlice] = useState<number | null>(null);

  useEffect(() => {
    loadAnalytics("week").then((d) => {
      setData(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.red} />
      </View>
    );
  }

  if (!data || data.totalVisits === 0) return null;

  const cuisineSlices: DonutSlice[] = data.cuisineBreakdown.slice(0, 6).map((s, i) => ({
    label: CUISINE_LABELS[s.cuisine] ?? s.cuisine,
    value: s.count,
    color: CUISINE_PALETTE[i % CUISINE_PALETTE.length],
  }));

  const dowBars: VBar[] = data.dayOfWeekCounts.map((c, i) => ({
    label: DOW_LABELS[i],
    value: c,
  }));
  const dowAccentIndex = dowBars.reduce(
    (best, cur, i, arr) => (cur.value > arr[best].value ? i : best),
    0,
  );

  // Center text: swaps to the focused slice's value when one is selected.
  const centerVal = focusedSlice != null
    ? String(cuisineSlices[focusedSlice]?.value ?? 0)
    : String(data.totalVisits);
  const centerLab = focusedSlice != null
    ? cuisineSlices[focusedSlice]?.label.toLowerCase() ?? "visits"
    : "visits";

  return (
    <View style={styles.wrap}>
      {cuisineSlices.length > 0 && (
        <View style={styles.card}>
          <View style={styles.headRow}>
            <Text style={type.micro}>CUISINE THIS WEEK</Text>
            {focusedSlice != null && (
              <Pressable onPress={() => setFocusedSlice(null)}>
                <Text style={styles.clearLink}>Clear</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.donutRow}>
            <DonutChart
              data={cuisineSlices}
              size={140}
              thickness={18}
              centerValue={centerVal}
              centerLabel={centerLab}
              focusedIndex={focusedSlice}
            />
            <View style={{ flex: 1, marginLeft: 16 }}>
              {cuisineSlices.slice(0, 4).map((s, i) => {
                const isFocused = focusedSlice === i;
                return (
                  <Pressable
                    key={s.label}
                    onPress={() => setFocusedSlice((cur) => (cur === i ? null : i))}
                    style={[styles.legendRow, isFocused && styles.legendRowActive]}
                  >
                    <View style={[styles.dot, { backgroundColor: s.color }]} />
                    <Text
                      style={[styles.legendLabel, isFocused && { color: colors.ink, fontWeight: "800" }]}
                      numberOfLines={1}
                    >
                      {s.label}
                    </Text>
                    <Text style={[styles.legendValue, isFocused && { color: colors.red }]}>
                      {s.value}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={styles.hint}>Tap a cuisine to focus it.</Text>
        </View>
      )}

      {dowBars.some((b) => b.value > 0) && (
        <View style={styles.card}>
          <Text style={type.micro}>WHICH DAYS</Text>
          <View style={{ marginTop: 12 }}>
            <VerticalBars data={dowBars} accentIndex={dowAccentIndex} height={110} />
          </View>
          <Text style={styles.hint}>Tap a bar to focus.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg, gap: 12 },
  center: { padding: 30, alignItems: "center" },
  card: {
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  clearLink: { fontSize: 12, fontWeight: "700", color: colors.red },
  donutRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  legendRowActive: {
    backgroundColor: colors.faint,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  legendLabel: { flex: 1, fontSize: 13, color: colors.ink, fontWeight: "500" },
  legendValue: { fontSize: 13, fontWeight: "700", color: colors.mute },
  hint: { fontSize: 11, color: colors.mute, marginTop: 10, fontStyle: "italic" },
});
