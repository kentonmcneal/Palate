import { useCallback, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  SectionList,
  Pressable,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { Text } from "../../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { colors, spacing, type } from "../../theme";
import { recentVisits, type Visit } from "../../lib/visits";
import { getInbox } from "../../lib/passive-confirm";
import { groupByDay, repeatOrdinals, filterVisits } from "../../lib/visit-history";
import { loadView } from "../../lib/load-state";
import { LoadError } from "../../components/LoadError";

/**
 * Visits — the dining memory, finally somewhere you can find it.
 *
 * Palate's thesis is that capture happens quietly and accumulates into a
 * history worth having. That history had no home: /all-visits existed but was
 * not a tab, so the product's central object was two levels down behind a
 * "View all" link, and the app's own claim was invisible to the person it was
 * being made about.
 *
 * It reads as a memory rather than a table: grouped by day, named "Today" and
 * "Yesterday" where that is what a person would say, and leading with the one
 * number that carries meaning here — which time this was. Repeat visits are the
 * signal Palate is built on, so "4th visit" belongs on the row and a rating
 * does not.
 */
export default function VisitsScreen() {
  const router = useRouter();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [pending, setPending] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const [all, inbox] = await Promise.all([
        recentVisits(500),
        getInbox().catch(() => []),
      ]);
      setVisits(all);
      setPending(inbox.length);
      setError(null);
    } catch (e: any) {
      setError(e ?? new Error("visits load failed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Ordinals come from the FULL history, not the filtered view — searching for
  // one restaurant must not renumber your visits to it.
  const ordinals = useMemo(() => repeatOrdinals(visits), [visits]);
  const sections = useMemo(
    () => groupByDay(filterVisits(visits, query)).map((d) => ({
      key: d.key, title: d.label, data: d.visits,
    })),
    [visits, query],
  );

  const searching = query.trim().length > 0;
  const view = loadView({ loading, error, count: visits.length });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={type.title}>Visits</Text>
        <Text style={[type.body, { color: colors.mute, marginTop: 4 }]}>
          {visits.length === 0
            ? "Everywhere you've eaten will collect here."
            : `${visits.length} ${visits.length === 1 ? "meal" : "meals"}, oldest to newest.`}
        </Text>
      </View>

      {/* Pending review sits above the history, because it is the only part
          that is asking something of you. */}
      {pending > 0 && (
        <Pressable
          onPress={() => router.push("/digest" as never)}
          style={styles.pending}
          accessibilityRole="button"
        >
          <Text style={styles.pendingText}>
            {pending === 1 ? "1 visit is waiting for you" : `${pending} visits are waiting for you`}
          </Text>
          <Text style={styles.pendingChev}>→</Text>
        </Pressable>
      )}

      {visits.length > 0 && (
        <View style={styles.searchWrap}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search your visits"
            placeholderTextColor={colors.mute}
            style={styles.search}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
        </View>
      )}

      {view === "error" ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <LoadError error={error} onRetry={() => { setLoading(true); load(); }} />
        </View>
      ) : view === "loading" ? (
        <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
      ) : visits.length === 0 ? (
        <View style={styles.center}>
          <Text style={type.subtitle}>Nothing here yet.</Text>
          <Text style={styles.emptyBody}>
            Turn on tracking and your visits collect themselves. You can always
            add one by hand.
          </Text>
          <Pressable
            onPress={() => router.push("/(tabs)/add" as never)}
            style={styles.emptyCta}
            accessibilityRole="button"
          >
            <Text style={styles.emptyCtaText}>Add a meal</Text>
          </Pressable>
        </View>
      ) : searching && sections.length === 0 ? (
        <View style={styles.center}>
          <Text style={type.subtitle}>No visits match "{query.trim()}".</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(v) => v.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section }) => (
            <Text style={styles.dayLabel}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <VisitRow
              visit={item}
              nth={ordinals.get(item.id) ?? 1}
              onPress={() => router.push(`/visit/${item.id}` as never)}
            />
          )}
          ListFooterComponent={
            <Pressable
              onPress={() => router.push("/(tabs)/add" as never)}
              style={styles.addRow}
              accessibilityRole="button"
            >
              <Text style={styles.addRowText}>Missing something? Add it →</Text>
            </Pressable>
          }
        />
      )}
    </SafeAreaView>
  );
}

function ordinalLabel(n: number): string {
  if (n === 1) return "First visit";
  const suffix = n % 100 >= 11 && n % 100 <= 13
    ? "th"
    : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix} visit`;
}

function VisitRow({
  visit, nth, onPress,
}: { visit: Visit; nth: number; onPress: () => void }) {
  const when = new Date(visit.visited_at)
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const name = visit.restaurant?.name ?? "Somewhere";
  const hidden = visit.is_public === false;

  return (
    <Pressable onPress={onPress} style={styles.row} accessibilityRole="button">
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.meta}>
          {when}
          {nth > 1 ? ` · ${ordinalLabel(nth)}` : ""}
          {visit.detection_source === "auto" ? " · captured" : ""}
        </Text>
      </View>
      {/* Hidden is stated, never implied. Somebody who curated their profile
          should be able to see at a glance what friends cannot. */}
      {hidden && <Text style={styles.hidden}>Hidden</Text>}
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  center: { padding: 48, alignItems: "center" },
  emptyBody: { ...type.small, marginTop: 8, lineHeight: 20, textAlign: "center" },
  emptyCta: {
    marginTop: spacing.lg, paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 999, backgroundColor: colors.red,
  },
  emptyCtaText: { color: "#fff", fontSize: 15, fontWeight: "800" },

  pending: {
    marginHorizontal: spacing.lg, marginTop: spacing.sm,
    paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: 16, backgroundColor: colors.red,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  pendingText: { color: "#fff", fontSize: 15, fontWeight: "800", flex: 1 },
  pendingChev: { color: "#fff", fontSize: 16, fontWeight: "800" },

  searchWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  search: {
    height: 44, borderRadius: 12, paddingHorizontal: 14,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
    color: colors.ink, fontSize: 15,
  },

  dayLabel: {
    ...type.micro,
    marginTop: spacing.lg, marginBottom: 8,
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
  meta: { ...type.small, marginTop: 3 },
  hidden: {
    fontSize: 11, fontWeight: "800", color: colors.mute,
    borderWidth: 1, borderColor: colors.line, borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  chev: { color: colors.mute, fontSize: 20, fontWeight: "600" },

  addRow: { paddingVertical: 22, alignItems: "center" },
  addRowText: { fontSize: 14, fontWeight: "700", color: colors.red },
});
