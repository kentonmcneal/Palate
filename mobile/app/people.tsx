import { useCallback, useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Avatar } from "../components/Avatar";
import { loadCompatiblePeople, compatibilityLine, type CompatiblePerson } from "../lib/social";
import { colors, spacing, type, card, shadow } from "../theme";
import {
  browseProfiles,
  needsDiscoveryPrompt, markDiscoveryPrompted,
  type PublicProfile,
} from "../lib/social";
import { setProfileVisibility } from "../lib/profile";
import { loadPalateMatches } from "../lib/palate/pairCompatibility";
import type { PalateMatch } from "../lib/recommendation/palate-match";
import { triggerHapticSelection } from "../lib/haptics";
import { TextInput } from "../components/TextInput";
import { searchUsers, followUser, unfollowUser, listFollowing, type FriendProfile } from "../lib/friends";
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
  const [compatible, setCompatible] = useState<CompatiblePerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Accounts created before the directory existed signed up under 'friends'.
  // They are asked once rather than switched for them — a default governs
  // people who haven't decided, not people who have.
  const [askDiscovery, setAskDiscovery] = useState(false);
  // Search folded in from the old Friends screen's "Find" tab. It searches the
  // same directory the grid shows, so a name you can see you can also type.
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<FriendProfile[] | null>(null);
  // Who you already follow, so a tile can say "Following" instead of offering
  // to do it again.
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const rows = await browseProfiles(50, 0);
      setPeople(rows);
      void listFollowing()
        .then((f) => setFollowing(new Set(f.map((x) => x.friend.id))))
        .catch(() => {});

      // Ranked across everybody, server-side, in one call. A directory without
      // it is still a directory, so a failure here never fails the screen.
      loadCompatiblePeople(5)
        .then(setCompatible)
        .catch(() => setCompatible([]));

      // Matches load AFTER the list renders, and in ONE round trip — this
      // used to be a call per person, each re-fetching the caller's own
      // vector as well (migration 0065).
      try {
        setMatches(await loadPalateMatches(rows.map((p) => p.id)));
      } catch {
        // A directory without scores is still a directory.
      }
    } catch (e: unknown) {
      void captureError(e, { at: "people:load" });
      setError("Couldn't load people. Pull to retry.");
      setPeople([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void needsDiscoveryPrompt().then(setAskDiscovery).catch(() => {});
  }, []);

  // Following from the grid, without leaving it. The server is the authority;
  // the local set is only so the tile stops offering what you just did.
  async function toggleFollow(id: string) {
    setBusy(id);
    try {
      if (following.has(id)) {
        await unfollowUser(id);
        setFollowing((prev) => { const n = new Set(prev); n.delete(id); return n; });
      } else {
        await followUser(id);
        setFollowing((prev) => new Set(prev).add(id));
      }
    } catch { /* the tile stays as it was */ }
    finally { setBusy(null); }
  }

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

        <View style={styles.searchRow}>
          <TextInput
            value={q}
            onChangeText={async (t: string) => {
              setQ(t);
              if (t.trim().length < 2) { setHits(null); return; }
              try { setHits(await searchUsers(t)); } catch { setHits([]); }
            }}
            placeholder="Search by name, handle or email"
            placeholderTextColor={colors.mute}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
          />
        </View>

        {hits !== null && (
          <View style={styles.hits}>
            {hits.length === 0 && <Text style={styles.emptyLine}>Nobody by that name.</Text>}
            {hits.map((h) => (
              <Pressable key={h.id} style={styles.hitRow} onPress={() => router.push(`/profile/${h.id}` as never)}>
                <Avatar uri={h.avatar_url} name={h.display_name} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.compatName} numberOfLines={1}>
                    {h.display_name || (h.username ? `@${h.username}` : "Someone")}
                  </Text>
                  {!!h.username && !!h.display_name && <Text style={styles.handle}>@{h.username}</Text>}
                </View>
                <FollowPill
                  following={following.has(h.id)}
                  busy={busy === h.id}
                  onPress={() => void toggleFollow(h.id)}
                />
              </Pressable>
            ))}
          </View>
        )}

        {/* Ranked across everybody, not just friends, so a new tester can find
            somebody worth following before they have any. Each row says what it
            is claiming, because a checkable sentence beats a percentage. */}
        {compatible.length > 0 && (
          <View style={styles.compatBlock}>
            <Text style={styles.compatEyebrow}>WHO EATS LIKE YOU</Text>
            {compatible.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => router.push(`/profile/${c.id}` as never)}
                style={styles.compatRow}
                accessibilityRole="button"
              >
                <Avatar uri={c.avatar_url} name={c.display_name} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.compatName} numberOfLines={1}>
                    {c.display_name || (c.username ? `@${c.username}` : "Someone")}
                  </Text>
                  <Text style={styles.compatWhy} numberOfLines={1}>
                    {compatibilityLine(c)}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {askDiscovery && (
          <View style={styles.askCard}>
            <Text style={styles.askTitle}>Be findable here?</Text>
            <Text style={styles.askBody}>
              Your profile is currently visible to friends only, so you don&apos;t
              appear in this list. Making it public lets people find you by
              palate match. You can change it any time in Settings.
            </Text>
            <View style={styles.askRow}>
              <Pressable
                style={styles.askPrimary}
                onPress={async () => {
                  setAskDiscovery(false);
                  await setProfileVisibility("public").catch(() => {});
                  await markDiscoveryPrompted().catch(() => {});
                  void load();
                }}
              >
                <Text style={styles.askPrimaryText}>Make me findable</Text>
              </Pressable>
              <Pressable
                style={styles.askGhost}
                onPress={async () => {
                  setAskDiscovery(false);
                  // Asked and declined — recorded so we never ask again.
                  await markDiscoveryPrompted().catch(() => {});
                }}
              >
                <Text style={styles.askGhostText}>Not now</Text>
              </Pressable>
            </View>
          </View>
        )}

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

        {/* Explore, not a phone book. Faces in a grid read as a room full of
            people; a stacked list of bios reads as admin. The match percentage
            rides on the tile because it is the reason to tap. */}
        <View style={styles.grid}>
          {sorted.map((p) => (
            <PersonTile
              key={p.id}
              person={p}
              match={matches[p.id]}
              following={following.has(p.id)}
              busy={busy === p.id}
              onFollow={() => void toggleFollow(p.id)}
              onOpen={() => {
                void triggerHapticSelection();
                router.push(`/profile/${p.id}` as never);
              }}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FollowPill({ following, busy, onPress }: { following: boolean; busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={(e) => { e.stopPropagation(); onPress(); }}
      disabled={busy}
      style={[styles.pill, following && styles.pillGhost]}
      hitSlop={6}
      accessibilityRole="button"
    >
      <Text style={[styles.pillText, following && styles.pillGhostText]}>
        {busy ? "…" : following ? "Following" : "Follow"}
      </Text>
    </Pressable>
  );
}

function PersonTile({
  person, match, following, busy, onFollow, onOpen,
}: {
  person: PublicProfile; match?: PalateMatch; following: boolean;
  busy: boolean; onFollow: () => void; onOpen: () => void;
}) {
  const name = person.display_name || person.username || "Someone";
  const where = person.current_city || person.school || null;
  return (
    <Pressable style={styles.tile} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${name}. Open profile.`}>
      <Avatar uri={person.avatar_url} name={person.display_name} email={null} size={64} />
      <Text style={styles.tileName} numberOfLines={1}>{name}</Text>
      {match?.ready ? (
        <Text style={styles.tileMatch}>{match.score}% match</Text>
      ) : where ? (
        <Text style={styles.tileSub} numberOfLines={1}>{where}</Text>
      ) : (
        <Text style={styles.tileSub} numberOfLines={1}>
          {person.username ? `@${person.username}` : " "}
        </Text>
      )}
      <FollowPill following={following} busy={busy} onPress={onFollow} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchRow: { marginBottom: spacing.md },
  searchInput: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.ink,
    backgroundColor: colors.faint,
  },
  hits: { marginBottom: spacing.lg, gap: 4 },
  hitRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 18 },
  tile: {
    width: "31%", alignItems: "center", gap: 5,
  },
  tileName: { fontSize: 13, fontWeight: "700", color: colors.ink, textAlign: "center" },
  tileMatch: { fontSize: 11, fontWeight: "700", color: colors.red },
  tileSub: { fontSize: 11, fontWeight: "500", color: colors.mute },
  pill: {
    marginTop: 2, paddingVertical: 5, paddingHorizontal: 12,
    borderRadius: 999, backgroundColor: colors.ink,
  },
  pillGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.line },
  pillText: { fontSize: 11, fontWeight: "800", color: "#fff" },
  pillGhostText: { color: colors.ink },
  compatBlock: {
    marginTop: spacing.md, marginBottom: spacing.lg, padding: spacing.md,
    borderRadius: 18, backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  compatEyebrow: { ...type.micro, marginBottom: 8 },
  compatRow: {
    flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 9,
  },
  compatName: { fontSize: 15, fontWeight: "700", color: colors.ink },
  compatWhy: { ...type.small, marginTop: 2 },
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
  askCard: {
    padding: card.padding, borderRadius: card.radius,
    backgroundColor: colors.faint, marginBottom: spacing.md, ...shadow.card,
  },
  askTitle: { fontSize: 16, fontWeight: "800", color: colors.ink },
  askBody: { ...type.small, marginTop: 6, lineHeight: 19 },
  askRow: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  askPrimary: {
    paddingHorizontal: 14, minHeight: 40, paddingVertical: 10,
    borderRadius: 999, backgroundColor: colors.red, justifyContent: "center",
  },
  askPrimaryText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  askGhost: {
    paddingHorizontal: 14, minHeight: 40, paddingVertical: 10,
    borderRadius: 999, backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.line, justifyContent: "center",
  },
  askGhostText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
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
  links: { flexDirection: "row", gap: 8, marginTop: 10 },
  linkChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line,
  },
  linkChipText: { fontSize: 12, fontWeight: "700", color: colors.ink },
});
