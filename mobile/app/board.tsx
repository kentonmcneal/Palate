import { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Text } from "../components/Text";
import { TextInput } from "../components/TextInput";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { colors, spacing, type, card, shadow } from "../theme";
import { Avatar } from "../components/Avatar";
import { Spacer } from "../components/Button";
import { useSuggestions } from "../lib/use-suggestions";
import {
  BOARD_CATEGORIES, loadBoard, loadRegulars,
  type BoardCategory, type BoardScope, type BoardWindow, type BoardRow, type RegularRow,
} from "../lib/board";

// ============================================================================
// board — several leaderboards, so most people lead one.
// ----------------------------------------------------------------------------
// Four standing boards plus a search: type a restaurant and see who its
// regulars are. Scope toggles between the people you follow and everyone with
// a public profile; the window between this week and all time.
//
// Every board is the same shape — rank, face, name, number — so switching
// between them is reading, not re-learning.
// ============================================================================

const WINDOWS: { key: BoardWindow; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
];

export default function BoardScreen() {
  const router = useRouter();
  const [cat, setCat] = useState<BoardCategory>("never_cooks");
  const [scope, setScope] = useState<BoardScope>("everyone");
  const [win, setWin] = useState<BoardWindow>("all");
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  // restaurant_regulars is a plain aggregate over visits — free — so this can
  // simply run as you type. Nothing here touches Google.
  const { suggestions: regulars, loading: searching } = useSuggestions<RegularRow>(
    q,
    useCallback((query: string) => loadRegulars(query), []),
  );

  const meta = BOARD_CATEGORIES.find((c) => c.key === cat)!;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await loadBoard(cat, scope, win));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load the board.");
    } finally {
      setLoading(false);
    }
  }, [cat, scope, win]);

  useEffect(() => { void load(); }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ title: "Board" }} />
      <ScrollView contentContainerStyle={styles.body}>
        {/* Category */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {BOARD_CATEGORIES.map((c) => (
            <Pressable key={c.key} onPress={() => setCat(c.key)} style={[styles.chip, cat === c.key && styles.chipOn]}>
              <Text style={[styles.chipText, cat === c.key && styles.chipTextOn]}>{c.tab}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={styles.blurb}>{meta.blurb}</Text>

        {/* Scope + window */}
        <View style={styles.filters}>
          {(["everyone", "following"] as BoardScope[]).map((s) => (
            <Pressable key={s} onPress={() => setScope(s)} style={[styles.pill, scope === s && styles.pillOn]}>
              <Text style={[styles.pillText, scope === s && styles.pillTextOn]}>
                {s === "everyone" ? "Everyone" : "People you follow"}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.filters}>
          {WINDOWS.map((w) => (
            <Pressable key={w.key} onPress={() => setWin(w.key)} style={[styles.pill, win === w.key && styles.pillOn]}>
              <Text style={[styles.pillText, win === w.key && styles.pillTextOn]}>{w.label}</Text>
            </Pressable>
          ))}
        </View>

        <Spacer size={14} />

        {loading && <ActivityIndicator color={colors.mute} />}
        {!loading && error && <Text style={styles.error}>{error}</Text>}
        {!loading && !error && rows.length === 0 && (
          <Text style={styles.emptyLine}>
            {win === "week"
              ? "Nothing logged this week yet. Be the first."
              : "Not enough logged visits for this board yet."}
          </Text>
        )}

        {!loading && !error && rows.map((r, i) => (
          <Row key={r.user_id} rank={i + 1} row={r} unit={meta.unit(r.value)} onPress={() => router.push(`/profile/${r.user_id}` as never)} />
        ))}

        {/* Regulars search */}
        <View style={styles.searchCard}>
          <Text style={styles.searchHead}>REGULARS AT…</Text>
          <Text style={styles.searchBlurb}>Type a restaurant. See who has been the most.</Text>
          <View style={styles.searchRow}>
            <TextInput
              value={q}
              onChangeText={setQ}
              returnKeyType="search"
              placeholder="Restaurant name"
              placeholderTextColor={colors.mute}
              style={styles.input}
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>

          {q.trim().length >= 2 && regulars.length === 0 && !searching && (
            <Text style={styles.emptyLine}>Nobody here has logged a place by that name.</Text>
          )}
          {regulars.map((r, i) => (
            <Row
              key={r.user_id}
              rank={i + 1}
              row={r}
              unit={r.value === 1 ? "visit" : "visits"}
              subtitle={r.restaurant_name}
              onPress={() => router.push(`/profile/${r.user_id}` as never)}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ rank, row, unit, subtitle, onPress }: {
  rank: number; row: BoardRow; unit: string; subtitle?: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.row, row.you && styles.rowYou]} accessibilityRole="button">
      <Text style={[styles.rank, rank <= 3 && styles.rankTop]}>{rank}</Text>
      <Avatar uri={row.avatar_url} name={row.display_name} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>
          {row.display_name || (row.username ? `@${row.username}` : "Someone")}
          {row.you ? "  · you" : ""}
        </Text>
        {!!(row.detail || subtitle) && (
          <Text style={styles.detail} numberOfLines={1}>{row.detail || subtitle}</Text>
        )}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={styles.value}>{row.value}</Text>
        <Text style={styles.unit}>{unit}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  chipRow: { gap: 6, paddingVertical: spacing.sm, paddingRight: spacing.lg },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.faint },
  chipOn: { backgroundColor: colors.ink },
  chipText: { fontSize: 13, fontWeight: "700", color: colors.mute },
  chipTextOn: { color: "#fff" },
  blurb: { ...type.small, marginTop: 4, marginBottom: 10 },
  filters: { flexDirection: "row", gap: 6, marginBottom: 6, flexWrap: "wrap" },
  pill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.line },
  pillOn: { backgroundColor: colors.red, borderColor: colors.red },
  pillText: { fontSize: 12, fontWeight: "600", color: colors.ink },
  pillTextOn: { color: "#fff" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  rowYou: { backgroundColor: colors.faint, borderRadius: 12, paddingHorizontal: 8, marginHorizontal: -8 },
  rank: { width: 20, fontSize: 13, fontWeight: "800", color: colors.mute },
  rankTop: { color: colors.red },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink },
  detail: { fontSize: 12, fontWeight: "500", color: colors.mute, marginTop: 1 },
  value: { fontSize: 17, fontWeight: "800", color: colors.ink, letterSpacing: -0.3 },
  unit: { fontSize: 10, fontWeight: "600", color: colors.mute },
  error: { ...type.small, color: colors.redText },
  emptyLine: { ...type.small, marginTop: 8 },
  searchCard: {
    marginTop: spacing.xl, padding: card.padding, borderRadius: card.radius,
    backgroundColor: colors.faint, ...shadow.card,
  },
  searchHead: { ...type.micro, fontSize: 10 },
  searchBlurb: { ...type.small, marginTop: 4 },
  searchRow: { marginTop: 10 },
  input: {
    flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.ink,
    backgroundColor: colors.paper,
  },
});
