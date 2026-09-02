import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Avatar } from "../components/Avatar";
import { colors, spacing, type, card, shadow } from "../theme";
import { browseProfiles, instagramUrl, tiktokUrl, type PublicProfile } from "../lib/social";
import { loadPalateMatch } from "../lib/palate/pairCompatibility";
import type { PalateMatch } from "../lib/recommendation/palate-match";
import { triggerHapticSelection } from "../lib/haptics";
import { captureError } from "../lib/observability";

// ============================================================================
// people — the directory.
// ----------------------------------------------------------------------------
// Ranked by palate match, not by recency or alphabet. That ordering is the
// whole point: a list of strangers sorted by how much your eating overlaps is
// a reason to tap; a list sorted by signup date is a phone book.
//
// Who appears here is decided server-side by browse_profiles (migration 0056)
// — public profiles only, never blocked accounts in either direction. There is
// deliberately no client-side visibility filter to get out of sync with it.
// ============================================================================

export default function PeopleScreen() {
  const router = useRouter();
  const [people, setPeople] = useState<PublicProfile[] | null>(null);
  const [matches, setMatches] = useState<Record<string, PalateMatch>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const rows = await browseProfiles(50, 0);
      setPeople(rows);

      // Matches load AFTER the list renders — the directory must not wait on
      // one round trip per person. (Batching this into a single RPC is the
      // right fix once there are more than a handful of people; noted in
      // SPRINT_LOG.)
      const settled = await Promise.all(
        rows.map(async (p) => {
          try {
            return [p.id, await loadPalateMatch(p.id)] as const;
          } catch {
            return null;
          }
        }),
      );
      const next: Record<string, PalateMatch> = {};
      for (const row of settled) if (row) next[row[0]] = row[1];
      setMatches(next);
    } catch (e: unknown) {
      void captureError(e, { at: "people:load" });
      setError("Couldn't load people. Pull to retry.");
      setPeople([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sorted = people
    ? [...people].sort((a, b) => {
        // Unscored pairs sink to the bottom — "not enough data" is not "low
        // match", and sorting them as 0 would bury newcomers permanently.
        const scoreOf = (id: string) => {
          const m = matches[id];
          return m && m.ready ? m.score : -1;
        };
        return scoreOf(b.id) - scoreOf(a.id);
      })
    : [];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>People</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          />
        }
      >
        <Text style={styles.lead}>
          Sorted by how much your palate overlaps with theirs.
        </Text>

        {people === null && (
          <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
        )}

        {!!error && <Text style={styles.error}>{error}</Text>}

        {people !== null && people.length === 0 && !error && (
          <View style={styles.empty}>
            <Text style={styles.emptyGlyph}>◎</Text>
            <Text style={styles.emptyLine}>No one else is discoverable yet.</Text>
          </View>
        )}

        {sorted.map((p) => (
          <PersonRow key={p.id} person={p} match={matches[p.id]} onOpen={() => {
            void triggerHapticSelection();
            router.push(`/profile/${p.id}` as never);
          }} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function PersonRow({
  person, match, onOpen,
}: { person: PublicProfile; match?: PalateMatch; onOpen: () => void }) {
  const name = person.display_name || person.username || "Someone";
  const sub = [person.school, person.current_city].filter(Boolean).join(" · ");

  return (
    <Pressable style={styles.row} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${name}. Open profile.`}>
      <Avatar uri={person.avatar_url} name={person.display_name} email={null} size={52} />
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {match?.ready && (
            <View style={styles.matchChip}>
              <Text style={styles.matchChipText}>{match.score}%</Text>
            </View>
          )}
        </View>
        {!!person.username && <Text style={styles.handle}>@{person.username}</Text>}
        {!!person.bio && <Text style={styles.bio} numberOfLines={2}>{person.bio}</Text>}
        {!!sub && <Text style={styles.sub} numberOfLines={1}>{sub}</Text>}

        {(person.instagram_handle || person.tiktok_handle) && (
          <View style={styles.links}>
            {!!person.instagram_handle && (
              <Pressable
                onPress={(e) => { e.stopPropagation(); void Linking.openURL(instagramUrl(person.instagram_handle!)); }}
                style={styles.linkChip}
                accessibilityRole="link"
                accessibilityLabel={`${name} on Instagram`}
              >
                <Text style={styles.linkChipText}>Instagram</Text>
              </Pressable>
            )}
            {!!person.tiktok_handle && (
              <Pressable
                onPress={(e) => { e.stopPropagation(); void Linking.openURL(tiktokUrl(person.tiktok_handle!)); }}
                style={styles.linkChip}
                accessibilityRole="link"
                accessibilityLabel={`${name} on TikTok`}
              >
                <Text style={styles.linkChipText}>TikTok</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.faint,
  },
  closeText: { fontSize: 20, color: colors.ink },
  body: { padding: spacing.lg, paddingTop: 0 },
  lead: { ...type.small, marginBottom: spacing.md },
  center: { paddingVertical: spacing.xxl, alignItems: "center" },
  error: { ...type.small, color: colors.redText },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: 6 },
  emptyGlyph: { fontSize: 22, color: colors.line },
  emptyLine: { ...type.small },
  row: {
    flexDirection: "row", gap: 12, alignItems: "flex-start",
    padding: card.padding,
    borderRadius: card.radius,
    backgroundColor: colors.faint,
    marginBottom: 10,
    ...shadow.card,
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  name: { fontSize: 16, fontWeight: "800", color: colors.ink, flexShrink: 1 },
  handle: { ...type.small, marginTop: 1 },
  bio: { ...type.small, color: colors.inkDim, marginTop: 6 },
  sub: { ...type.small, marginTop: 4 },
  matchChip: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: colors.redTint, borderWidth: 1, borderColor: colors.redTintBorder,
  },
  matchChipText: { fontSize: 12, fontWeight: "800", color: colors.redText },
  links: { flexDirection: "row", gap: 8, marginTop: 10 },
  linkChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line,
  },
  linkChipText: { fontSize: 12, fontWeight: "700", color: colors.ink },
});
