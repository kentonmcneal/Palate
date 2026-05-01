import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Spacer } from "../components/Button";
import { colors, spacing, type } from "../theme";
import { loadAnalytics, type AnalyticsSummary, type TimeRange } from "../lib/analytics-stats";
import { computeAspirationalPalate, type AspirationalPalate } from "../lib/aspirational-palate";
import { computeLocationPatterns, type LocationPatternSummary } from "../lib/location-analytics";
import { computeTasteVector } from "../lib/taste-vector";
import { generateIdentitySet, type PalateIdentitySet } from "../lib/palate-labels";
import { DonutChart, type DonutSlice } from "../components/charts/DonutChart";
import { HorizontalBars, type BarRow } from "../components/charts/HorizontalBars";
import { VerticalBars, type VBar } from "../components/charts/VerticalBars";
import { HourlyHistogram } from "../components/charts/HourlyHistogram";

const RANGE_OPTIONS: Array<{ key: TimeRange; short: string; long: string }> = [
  { key: "week",    short: "Week",    long: "this week" },
  { key: "month",   short: "Month",   long: "this month" },
  { key: "quarter", short: "Quarter", long: "this quarter" },
  { key: "year",    short: "Year",    long: "this year" },
  { key: "all",     short: "All",     long: "all time" },
];

function rangeLabel(range: TimeRange): string {
  return RANGE_OPTIONS.find((r) => r.key === range)?.long ?? "all time";
}

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
  const [aspirational, setAspirational] = useState<AspirationalPalate | null>(null);
  const [location, setLocation] = useState<LocationPatternSummary | null>(null);
  const [identities, setIdentities] = useState<PalateIdentitySet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<TimeRange>("all");

  const load = useCallback(async (r: TimeRange) => {
    setLoading(true);
    setError(null);
    try {
      // Stats are range-bound; identities + aspirational + location patterns
      // are cross-range (always read all-time + this-week) so they don't need
      // to refetch when the user toggles ranges.
      const [stats, asp, loc, allTimeVec, weekVec] = await Promise.all([
        loadAnalytics(r),
        computeAspirationalPalate().catch(() => null),
        computeLocationPatterns().catch(() => null),
        computeTasteVector().catch(() => null),
        computeTasteVector({ sinceDays: 7 }).catch(() => null),
      ]);
      setData(stats);
      setAspirational(asp);
      setLocation(loc);
      if (allTimeVec) {
        setIdentities(generateIdentitySet(allTimeVec, weekVec ?? undefined));
      }
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load your insights");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(range); }, [load, range]));

  function handleRangeChange(next: TimeRange) {
    if (next === range) return;
    setRange(next);
    load(next);
  }

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
        {/* Range selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rangeRow}
        >
          {RANGE_OPTIONS.map((opt) => {
            const active = opt.key === range;
            return (
              <Pressable
                key={opt.key}
                onPress={() => handleRangeChange(opt.key)}
                style={[styles.rangePill, active && styles.rangePillActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.rangePillText, active && styles.rangePillTextActive]}>
                  {opt.short}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

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
            <Pressable onPress={() => load(range)} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable>
          </View>
        )}

        {!loading && !error && data && data.totalVisits === 0 && (
          <View style={styles.emptyCard}>
            <Text style={type.subtitle}>Nothing to read for {rangeLabel(range)}.</Text>
            <Text style={[type.small, { marginTop: 6, lineHeight: 20 }]}>
              {range === "all"
                ? "Once you've logged a few visits, this is where your patterns surface — cuisine mix, where you eat, what time."
                : "No visits logged in this range yet. Try a wider window above, or come back after a few more visits."}
            </Text>
          </View>
        )}

        {!loading && !error && data && data.totalVisits > 0 && (
          <>
            {identities && <PalateIdentityCard identities={identities} />}
            <Dashboard
              data={data}
              range={range}
              aspirational={aspirational}
              location={location}
            />
          </>
        )}

        {!loading && !error && data && data.totalVisits === 0 && aspirational && (
          // Even with no visits, if they've saved a few spots we can show their
          // aspirational read alone — gives the screen something to live on.
          <View style={{ marginTop: spacing.xl }}>
            <AspirationalCard aspirational={aspirational} actualSummary={null} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================================
// Dashboard — rendered when we have actual data
// ============================================================================

function Dashboard({
  data,
  range,
  aspirational,
  location,
}: {
  data: AnalyticsSummary;
  range: TimeRange;
  aspirational: AspirationalPalate | null;
  location: LocationPatternSummary | null;
}) {
  const isAllTime = range === "all";
  const heroEyebrow = isAllTime
    ? "YOUR EATING LIFE · ALL TIME"
    : `YOUR EATING LIFE · ${rangeLabel(range).toUpperCase()}`;

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
        <Text style={styles.heroEyebrow}>{heroEyebrow}</Text>
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

      {/* WHEN you eat — hourly distribution is now the primary view. */}
      <Section title="When you eat" subtitle="Hour-by-hour across the day">
        <HourlyHistogram data={data.hourlyCounts} />
        {data.hourlyInsights.length > 0 && (
          <View style={styles.hourlyInsights}>
            {data.hourlyInsights.map((ins) => (
              <Text key={ins.pattern} style={styles.hourlyInsightText}>
                · {ins.text}
              </Text>
            ))}
          </View>
        )}
        {/* Meal buckets demoted to a compact summary row below the histogram. */}
        <View style={styles.mealRow}>
          {mealBars.map((m) => (
            <View key={m.label} style={styles.mealChip}>
              <Text style={styles.mealChipValue}>{m.value}</Text>
              <Text style={styles.mealChipLabel}>{m.label}</Text>
            </View>
          ))}
        </View>
      </Section>

      {/* Day of week */}
      <Section title="Which days" subtitle="Sunday → Saturday">
        <VerticalBars data={dowBars} accentIndex={dowAccentIndex} height={150} />
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

      {/* Neighborhoods */}
      {location && location.mostVisitedNeighborhoods.length > 0 && (
        <NeighborhoodSection location={location} />
      )}

      {/* Aspirational Palate */}
      {aspirational && (
        <AspirationalCard aspirational={aspirational} actualSummary={data} />
      )}

      <Text style={[type.small, { textAlign: "center", marginTop: 24, marginBottom: 12 }]}>
        These insights deepen with every visit you log.
      </Text>
    </>
  );
}

// ============================================================================
// Palate Identity card — primary + 2 secondary + weekly mood. Generated by
// the Palate Feature Engine from the multi-dimensional taste vector.
// ============================================================================
function PalateIdentityCard({ identities }: { identities: PalateIdentitySet }) {
  return (
    <View style={styles.identityCard}>
      <Text style={styles.identityEyebrow}>YOUR PALATE</Text>
      <Text style={styles.identityPrimary}>{identities.primary.label}</Text>
      {identities.primary.evidence.slice(0, 2).map((e, i) => (
        <Text key={i} style={styles.identityEvidence}>· {e}</Text>
      ))}

      <View style={styles.identitySecondaryRow}>
        <View style={styles.identitySecondaryCol}>
          <Text style={styles.identitySubLabel}>ALSO</Text>
          <Text style={styles.identitySecondary}>{identities.secondary[0].label}</Text>
        </View>
        <View style={styles.identitySecondaryCol}>
          <Text style={styles.identitySubLabel}>AND</Text>
          <Text style={styles.identitySecondary}>{identities.secondary[1].label}</Text>
        </View>
      </View>

      <View style={styles.identityMood}>
        <Text style={styles.identitySubLabel}>THIS WEEK</Text>
        <Text style={styles.identityMoodText}>{identities.weeklyMood.label}</Text>
      </View>
    </View>
  );
}

// ============================================================================
// Aspirational Palate card — the gap between where you go and where you save.
// ============================================================================
function AspirationalCard({
  aspirational,
  actualSummary,
}: {
  aspirational: AspirationalPalate;
  actualSummary: AnalyticsSummary | null;
}) {
  return (
    <View style={[styles.section, { backgroundColor: colors.ink }]}>
      <Text style={[type.micro, { color: "rgba(255,255,255,0.65)" }]}>ASPIRATIONAL PALATE</Text>
      <Spacer size={10} />
      <Text style={styles.aspInsight}>{aspirational.insight}</Text>

      {aspirational.topAspirationTags.length > 0 && (
        <>
          <Spacer size={16} />
          <Text style={styles.aspSubLabel}>WHAT YOU'RE SAVING FOR</Text>
          <View style={styles.aspTagRow}>
            {aspirational.topAspirationTags.map((t) => (
              <View key={t.tag} style={styles.aspDarkChip}>
                <Text style={styles.aspDarkChipText}>{t.tag.replace(/_/g, " ")}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {aspirational.aspirationalCuisines.length > 0 && actualSummary && (
        <>
          <Spacer size={16} />
          <View style={styles.aspCols}>
            <View style={{ flex: 1 }}>
              <Text style={styles.aspSubLabel}>YOU EAT</Text>
              {aspirational.actualCuisines.slice(0, 3).map((c) => (
                <Text key={c.cuisine} style={styles.aspMixLine}>
                  {CUISINE_LABELS[c.cuisine] ?? c.cuisine} · {Math.round(c.pct * 100)}%
                </Text>
              ))}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.aspSubLabel}>YOU SAVE</Text>
              {aspirational.aspirationalCuisines.slice(0, 3).map((c) => (
                <Text key={c.cuisine} style={[styles.aspMixLine, { color: colors.red }]}>
                  {CUISINE_LABELS[c.cuisine] ?? c.cuisine} · {Math.round(c.pct * 100)}%
                </Text>
              ))}
            </View>
          </View>
        </>
      )}

      {aspirational.aspirationalNeighborhoods.length > 0 && (
        <>
          <Spacer size={14} />
          <Text style={styles.aspSubLabel}>NEIGHBORHOODS YOU'RE EYEING</Text>
          <View style={styles.aspTagRow}>
            {aspirational.aspirationalNeighborhoods.slice(0, 4).map((n) => (
              <View key={n} style={styles.aspDarkChip}>
                <Text style={styles.aspDarkChipText}>{n}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

// ============================================================================
// Neighborhood section — most visited, eating radius, new + aspirational.
// ============================================================================
function NeighborhoodSection({ location }: { location: LocationPatternSummary }) {
  return (
    <Section title="Where you eat (by area)">
      {location.mostVisitedNeighborhoods.slice(0, 5).map((n) => (
        <View key={n.neighborhood} style={styles.neighRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.neighName}>{n.neighborhood}</Text>
            <Text style={[type.small, { color: colors.mute, marginTop: 2 }]}>
              {Math.round(n.pct * 100)}% of visits
            </Text>
          </View>
          <Text style={styles.neighCount}>×{n.count}</Text>
        </View>
      ))}

      {location.eatingRadiusKm != null && location.eatingRadiusKm > 0 && (
        <View style={styles.neighFooter}>
          <Text style={type.micro}>EATING RADIUS</Text>
          <Text style={styles.neighRadius}>
            {location.eatingRadiusKm < 1
              ? `${Math.round(location.eatingRadiusKm * 1000)} m`
              : `${location.eatingRadiusKm.toFixed(1)} km`}
            {" "}from your usual center
          </Text>
        </View>
      )}

      {location.newNeighborhoods.length > 0 && (
        <View style={styles.neighFooter}>
          <Text style={type.micro}>NEW IN THE LAST 30 DAYS</Text>
          <View style={styles.neighChipRow}>
            {location.newNeighborhoods.slice(0, 4).map((n) => (
              <View key={n} style={styles.neighChip}>
                <Text style={styles.neighChipText}>{n}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </Section>
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

function capCase(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatValue}>{value}</Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
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

  // Range selector
  rangeRow: {
    flexDirection: "row",
    gap: 8,
    paddingBottom: spacing.lg,
  },
  rangePill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  rangePillActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  rangePillText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.mute,
    letterSpacing: 0.3,
  },
  rangePillTextActive: { color: "#fff" },

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

  hourlyInsights: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 4,
  },
  hourlyInsightText: { fontSize: 13, color: colors.ink, lineHeight: 19 },
  mealRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 8,
  },
  mealChip: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
  },
  mealChipValue: { fontSize: 18, fontWeight: "800", color: colors.ink },
  mealChipLabel: { fontSize: 11, fontWeight: "600", color: colors.mute, marginTop: 2, letterSpacing: 0.3 },
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

  // Palate Identity card (sits at top of dashboard)
  identityCard: {
    marginBottom: spacing.xl,
    padding: spacing.lg,
    borderRadius: 24,
    backgroundColor: colors.ink,
  },
  identityEyebrow: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  identityPrimary: {
    color: colors.red,
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.7,
    marginTop: 8,
    lineHeight: 34,
  },
  identityEvidence: { color: "rgba(255,255,255,0.78)", fontSize: 13, marginTop: 6, lineHeight: 18 },
  identitySecondaryRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 18,
    paddingTop: 16,
    borderTopColor: "rgba(255,255,255,0.12)",
    borderTopWidth: 1,
  },
  identitySecondaryCol: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  identitySubLabel: { color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: "700", letterSpacing: 1.4 },
  identitySecondary: { color: "#fff", fontSize: 14, fontWeight: "700", marginTop: 4, lineHeight: 18 },
  identityMood: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,48,8,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,48,8,0.3)",
  },
  identityMoodText: { color: "#fff", fontSize: 16, fontWeight: "800", marginTop: 4, letterSpacing: -0.3 },

  // Aspirational Palate (dark card)
  aspInsight: { color: "#fff", fontSize: 17, fontWeight: "700", lineHeight: 24, letterSpacing: -0.3 },
  aspSubLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 1.4, marginBottom: 8 },
  aspMixLine: { color: "rgba(255,255,255,0.85)", fontSize: 13, lineHeight: 20, fontWeight: "500" },
  aspCols: { flexDirection: "row", gap: 16 },
  aspTagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  aspDarkChip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  aspDarkChipText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  // Neighborhood rows
  neighRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    gap: 10,
  },
  neighName: { fontSize: 15, fontWeight: "700", color: colors.ink },
  neighCount: { fontSize: 14, fontWeight: "700", color: colors.red },
  neighFooter: {
    marginTop: 12,
    paddingTop: 12,
    borderTopColor: colors.line,
    borderTopWidth: 1,
  },
  neighRadius: { fontSize: 14, fontWeight: "600", color: colors.ink, marginTop: 4 },
  neighChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  neighChip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  neighChipText: { fontSize: 12, fontWeight: "600", color: colors.ink },
});
