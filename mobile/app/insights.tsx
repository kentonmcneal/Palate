import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Spacer } from "../components/Button";
import { colors, spacing, type } from "../theme";
import { loadAllTimeAnalytics, type AnalyticsSummary } from "../lib/analytics-stats";
import { DonutChart, type DonutSlice } from "../components/charts/DonutChart";
import { HorizontalBars, type BarRow } from "../components/charts/HorizontalBars";
import { VerticalBars, type VBar } from "../components/charts/VerticalBars";

const CUISINE_PALETTE = [
  "#FF3008", "#FF6B45", "#FF9466", "#FFB68C", "#1F1F1F", "#555555", "#9A9A9A",
];

const FORMAT_LABELS: Record<string, string> = {
  quick_service:  "Quick service",
  fast_casual:    "Fast casual",
  casual_dining:  "Casual dining",
  fine_dining:    "Fine dining",
  cafe:           "Café",
  bar:            "Bar",
};

const CUISINE_LABELS: Record<string, string> = {
  italian:         "Italian",
  mexican:         "Mexican",
  japanese:        "Japanese",
  chinese:         "Chinese",
  thai:            "Thai",
  indian:          "Indian",
  vietnamese:      "Vietnamese",
  korean:          "Korean",
  mediterranean:   "Mediterranean",
  "middle-eastern":"Middle Eastern",
  american:        "American",
  bbq:             "BBQ",
  seafood:         "Seafood",
  steakhouse:      "Steakhouse",
  bakery:          "Bakery",
  dessert:         "Dessert",
  "café":          "Café",
  healthy:         "Healthy",
  bar:             "Bar",
  other:           "Other",
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MEAL_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

export default function InsightsScreen() {
  const router = useRouter();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadAllTimeAnalytics());
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load your insights");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn} accessibilityLabel="Close">
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <Text style={type.title}>Your Insights</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.red} />
            <Text style={[type.small, { marginTop: 12 }]}>Reading your eating life…</Text>
          </View>
        )}

        {!loading && error && (
          <View style={styles.errCard}>
            <Text style={type.subtitle}>{error}</Text>
            <Spacer />
            <Pressable onPress={load} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable>
          </View>
        )}

        {!loading && !error && data && data.totalVisits === 0 && (
          <View style={styles.emptyCard}>
            <Text style={type.subtitle}>Nothing to read yet.</Text>
            <Text style={[type.small, { marginTop: 6, lineHeight: 20 }]}>
              Once you've logged a few visits, this is where your patterns surface — cuisine
              mix, where you eat, what time, how much you spend.
            </Text>
          </View>
        )}

        {!loading && !error && data && data.totalVisits > 0 && (
          <Dashboard data={data} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================================
// Dashboard — rendered when we have actual data
// ============================================================================

function Dashboard({ data }: { data: AnalyticsSummary }) {
  // ---------------- Cuisine donut ----------------
  const cuisineSlices: DonutSlice[] = data.cuisineBreakdown.map((s, i) => ({
    label: CUISINE_LABELS[s.cuisine] ?? s.cuisine,
    value: s.count,
    color: CUISINE_PALETTE[i % CUISINE_PALETTE.length],
  }));

  // ---------------- Format bars ----------------
  const formatRows: BarRow[] = data.formatBreakdown.map((f) => ({
    label: FORMAT_LABELS[f.format] ?? f.format,
    value: f.count,
    suffix: `${f.count} · ${Math.round(f.pct * 100)}%`,
  }));

  // ---------------- Meal time bars ----------------
  const mealBars: VBar[] = data.mealTimeBreakdown.map((m) => ({
    label: MEAL_LABELS[m.meal],
    value: m.count,
  }));
  const mealAccentIndex = mealBars.reduce(
    (best, cur, i, arr) => (cur.value > arr[best].value ? i : best),
    0,
  );

  // ---------------- Day of week bars ----------------
  const dowBars: VBar[] = data.dayOfWeekCounts.map((c, i) => ({
    label: DOW_LABELS[i],
    value: c,
  }));
  const dowAccentIndex = dowBars.reduce(
    (best, cur, i, arr) => (cur.value > arr[best].value ? i : best),
    0,
  );

  return (
    <>
      {/* Hero summary */}
      <View style={styles.heroCard}>
        <Text style={styles.heroEyebrow}>YOUR EATING LIFE · ALL TIME</Text>
        <Text style={styles.heroNumber}>{data.totalVisits}</Text>
        <Text style={styles.heroSub}>
          visits across{" "}
          <Text style={styles.heroSubStrong}>{data.uniqueRestaurants}</Text> different spots
        </Text>
        <View style={styles.heroStats}>
          <HeroStat label="Per week" value={data.avgVisitsPerWeek.toFixed(1)} />
          <HeroStat label="Variety" value={`${Math.round(data.varietyScore * 100)}%`} />
          <HeroStat
            label="Top spot"
            value={data.loyaltyScore > 0 ? `${Math.round(data.loyaltyScore * 100)}%` : "—"}
          />
        </View>
      </View>

      {/* Cuisine donut */}
      <Section title="Cuisine breakdown">
        <View style={styles.donutWrap}>
          <DonutChart
            data={cuisineSlices}
            size={220}
            thickness={26}
            centerValue={String(data.totalVisits)}
            centerLabel="visits"
          />
        </View>
        <Spacer />
        <View>
          {cuisineSlices.map((s) => (
            <View key={s.label} style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: s.color }]} />
              <Text style={styles.legendLabel}>{s.label}</Text>
              <Text style={styles.legendValue}>{s.value}</Text>
            </View>
          ))}
        </View>
      </Section>

      {/* Format bars */}
      <Section title="Where you eat" subtitle="Quick service vs sit-down vs café">
        <HorizontalBars data={formatRows} />
      </Section>

      {/* Meal time */}
      <Section title="When you eat" subtitle="Breakfast, lunch, dinner, snack">
        <VerticalBars data={mealBars} accentIndex={mealAccentIndex} height={170} />
      </Section>

      {/* Day of week */}
      <Section title="Which days" subtitle="Sunday → Saturday">
        <VerticalBars data={dowBars} accentIndex={dowAccentIndex} height={150} />
      </Section>

      {/* Spending */}
      <Section title="What it adds up to" subtitle="Estimate — based on price level + format">
        <View style={styles.spendRow}>
          <SpendStat label="This week" value={`$${Math.round(data.estimatedSpendPerWeek)}`} />
          <SpendStat label="At this pace, per year" value={`$${Math.round(data.estimatedSpendPerYear).toLocaleString()}`} highlight />
          <SpendStat label="All time" value={`$${Math.round(data.estimatedSpendAllTime).toLocaleString()}`} />
        </View>
        <Text style={[type.small, { marginTop: 14, lineHeight: 18 }]}>
          Heuristic estimate. Real bills will vary — but the ratio between weeks
          stays honest, which is the point.
        </Text>
      </Section>

      {/* Top spots */}
      <Section title="Where you keep going">
        {data.topSpots.map((s, i) => (
          <View key={s.name} style={styles.topRow}>
            <Text style={styles.topRank}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.topName}>{s.name}</Text>
              {s.cuisine && (
                <Text style={[type.small, { color: colors.mute, marginTop: 2 }]}>
                  {CUISINE_LABELS[s.cuisine] ?? s.cuisine}
                </Text>
              )}
            </View>
            <Text style={styles.topCount}>×{s.count}</Text>
          </View>
        ))}
      </Section>

      <Text style={[type.small, { textAlign: "center", marginTop: 24, marginBottom: 12 }]}>
        These insights deepen with every visit you log.
      </Text>
    </>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={type.micro}>{title.toUpperCase()}</Text>
      {subtitle && (
        <Text style={[type.small, { marginTop: 2, marginBottom: 14 }]}>{subtitle}</Text>
      )}
      {!subtitle && <Spacer size={12} />}
      {children}
    </View>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatValue}>{value}</Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </View>
  );
}

function SpendStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={[styles.spendStat, highlight && styles.spendStatHi]}>
      <Text style={[styles.spendValue, highlight && { color: colors.red }]}>{value}</Text>
      <Text style={styles.spendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.faint,
  },
  closeText: { fontSize: 16, fontWeight: "700", color: colors.ink },
  body: { padding: spacing.lg, paddingBottom: 80 },
  center: { padding: 60, alignItems: "center" },
  errCard: { padding: spacing.lg, borderRadius: 18, borderWidth: 1, borderColor: colors.line },
  retry: {
    alignSelf: "flex-start",
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 12, backgroundColor: colors.red,
  },
  retryText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  emptyCard: {
    marginTop: 24,
    padding: spacing.lg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
  },

  heroCard: {
    backgroundColor: colors.ink,
    borderRadius: 28,
    padding: spacing.lg,
    overflow: "hidden",
  },
  heroEyebrow: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  heroNumber: { color: colors.red, fontSize: 76, fontWeight: "800", letterSpacing: -3, marginTop: 8 },
  heroSub: { color: "rgba(255,255,255,0.85)", fontSize: 16, marginTop: -4 },
  heroSubStrong: { color: "#fff", fontWeight: "800" },
  heroStats: { flexDirection: "row", gap: 10, marginTop: 18 },
  heroStat: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.12)", borderWidth: 1,
    borderRadius: 14, padding: 12,
  },
  heroStatValue: { color: "#fff", fontSize: 20, fontWeight: "800" },
  heroStatLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase", marginTop: 4 },

  section: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: 22,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  donutWrap: { alignItems: "center", paddingVertical: 8 },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderTopColor: colors.line, borderTopWidth: 1,
  },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  legendLabel: { flex: 1, fontSize: 14, color: colors.ink, fontWeight: "500" },
  legendValue: { ...type.small, fontWeight: "700" },

  spendRow: { flexDirection: "row", gap: 10 },
  spendStat: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.faint,
  },
  spendStatHi: { borderColor: colors.red, backgroundColor: "#FFF1EE" },
  spendValue: { fontSize: 22, fontWeight: "800", color: colors.ink },
  spendLabel: { ...type.small, marginTop: 4 },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomColor: colors.line, borderBottomWidth: 1,
    gap: 14,
  },
  topRank: { ...type.small, fontWeight: "800", color: colors.mute, width: 20 },
  topName: { fontSize: 15, fontWeight: "600", color: colors.ink },
  topCount: { fontSize: 14, fontWeight: "700", color: colors.red },
});
