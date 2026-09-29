import { useCallback, useEffect, useRef, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { Text } from "../components/Text";
import { TextInput } from "../components/TextInput";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Avatar } from "../components/Avatar";
import { loadCompatiblePeople, compatibilityLine, browseProfiles, needsDiscoveryPrompt, type CompatiblePerson, type PublicProfile } from "../lib/social";
import { colors, spacing, type, card, shadow } from "../theme";
import { loadPalateMatches } from "../lib/palate/pairCompatibility";
import type { PalateMatch } from "../lib/recommendation/palate-match";
import { triggerHapticSelection } from "../lib/haptics";
import { searchUsers, followUser, unfollowUser, listFollowing, type FriendProfile } from "../lib/friends";
import { supabase } from "../lib/supabase";

// Search returns limited identity, not necessarily public profiles. Keep this
// defense-in-depth check alongside migration 0184's server-side block filter.
// Do not use hiddenUserIds: its fallback cannot establish both block directions.
async function readHidden(): Promise<Set<string>> {
  const { data, error } = await supabase.rpc("hidden_user_ids");
  if (error || !Array.isArray(data) || !data.every((id: unknown) => typeof id === "string" && id.length > 0)) {
    throw new Error("Privacy filter unavailable");
  }
  return new Set(data as string[]);
}

export default function PeopleScreen() {
  const router = useRouter();
  const [account, setAccount] = useState<{ id: string | null; generation: number } | null>(null);
  const [authError, setAuthError] = useState(false);
  const [retry, setRetry] = useState(0);
  const identity = useRef<string | null | undefined>(undefined);
  const generation = useRef(0);
  useEffect(() => {
    let alive = true;
    let notified = false;
    identity.current = undefined;
    setAuthError(false);
    const apply = (id: string | null) => {
      if (!alive || identity.current === id) return;
      identity.current = id;
      // Invalidate old action handlers immediately, before React unmounts.
      setAccount({ id, generation: ++generation.current });
      setAuthError(false);
    };
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      notified = true;
      apply(session?.user.id ?? null); // no async work inside the auth callback
    });
    void supabase.auth.getSession().then(({ data: sessionData, error }) => {
      if (!alive || notified) return;
      if (error) throw error;
      apply(sessionData.session?.user.id ?? null);
    }).catch(() => { if (alive && !notified) setAuthError(true); });
    return () => { alive = false; ++generation.current; data.subscription.unsubscribe(); };
  }, [retry]);

  const accountGeneration = account?.generation;
  const currentAccount = useCallback(() => generation.current === accountGeneration, [accountGeneration]);
  if (account?.id && !authError) {
    return <PeopleDirectory key={account.generation} currentAccount={currentAccount} />;
  }
  return (
    <SafeAreaView style={styles.safe}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.closeBtn}><Text>←</Text></Pressable>
      <View style={styles.center}>
        {authError ? <><Text style={styles.error}>Couldn&apos;t check your account.</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry account" onPress={() => setRetry(v => v + 1)}><Text>Try again</Text></Pressable></>
          : account ? <Text style={styles.emptyLine}>Sign in to browse people.</Text>
          : <ActivityIndicator color={colors.red} />}
      </View>
    </SafeAreaView>
  );
}

function PeopleDirectory({ currentAccount }: { currentAccount: () => boolean }) {
  const router = useRouter();
  const [people, setPeople] = useState<PublicProfile[] | null>(null);
  const [matches, setMatches] = useState<Record<string, PalateMatch>>({});
  const [compatible, setCompatible] = useState<CompatiblePerson[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchError, setMatchError] = useState(false);
  const [askDiscovery, setAskDiscovery] = useState(false);
  const [q, setQ] = useState("");
  const query = useRef("");
  const [hits, setHits] = useState<FriendProfile[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [following, setFollowing] = useState<Set<string> | null>(null);
  const followingRef = useRef<Set<string> | null>(null);
  const [followError, setFollowError] = useState(false);
  const [mutationErrors, setMutationErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string[]>([]);
  const active = useRef<object | null>(null);
  const directoryRequest = useRef(0), searchRequest = useRef(0), followingRequest = useRef(0);
  const pending = useRef(new Set<string>()), gates = useRef(new Set<string>());
  const hiddenIds = useRef(new Set<string>());
  const current = useCallback((view: object | null) => !!view && active.current === view && currentAccount(), [currentAccount]);

  const rememberHidden = useCallback((hidden: Set<string>) => {
    // A newer search can learn about a block while directory enrichment is
    // still pending. Never reintroduce that identity via a later response.
    for (const id of hidden) hiddenIds.current.add(id);
    setPeople(rows => rows?.filter(r => !hiddenIds.current.has(r.id)) ?? null);
    setCompatible(rows => rows.filter(r => !hiddenIds.current.has(r.id)));
    setHits(rows => rows?.filter(r => !hiddenIds.current.has(r.id)) ?? null);
    setMutationErrors(errors => Object.fromEntries(Object.entries(errors).filter(([id]) => !hiddenIds.current.has(id))));
  }, []);

  const loadFollowing = useCallback(async () => {
    const view = active.current;
    if (!current(view) || pending.current.size > 0) return;
    const sequence = ++followingRequest.current;
    try {
      const rows = await listFollowing();
      if (!current(view) || sequence !== followingRequest.current) return;
      followingRef.current = new Set(rows.map(r => r.friend.id));
      setFollowing(followingRef.current);
      setFollowError(false);
      gates.current.clear(); setBusy([]);
    } catch {
      if (!current(view) || sequence !== followingRequest.current) return;
      followingRef.current = null; setFollowing(null); setFollowError(true);
    }
  }, [current]);

  const search = useCallback(async (value: string) => {
    query.current = value; setQ(value);
    const sequence = ++searchRequest.current;
    const view = active.current;
    setHits(null); setSearchError(false); setSearching(false);
    // SQL search_users requires at least three trimmed characters.
    if (!current(view) || value.trim().length < 3) return;
    setSearching(true);
    try {
      // A successful privacy response remains authoritative even if search fails.
      const privacy = readHidden().then(hidden => {
        if (current(view) && sequence === searchRequest.current) rememberHidden(hidden);
      });
      const [, rows] = await Promise.all([privacy, searchUsers(value.trim())]);
      if (!current(view) || sequence !== searchRequest.current) return;
      setHits(rows.filter(r => !hiddenIds.current.has(r.id)));
    } catch {
      if (current(view) && sequence === searchRequest.current) setSearchError(true);
    } finally {
      if (current(view) && sequence === searchRequest.current) setSearching(false);
    }
  }, [current, rememberHidden]);

  const load = useCallback(async (refresh = false) => {
    const view = active.current;
    if (!current(view)) return;
    const sequence = ++directoryRequest.current;
    const valid = () => current(view) && sequence === directoryRequest.current;
    setRefreshing(refresh); setPeople(null); setCompatible([]); setMatches({}); setError(null); setMatchError(false);
    void loadFollowing();
    // Revalidate search on return/refresh as a block may have changed elsewhere.
    void search(query.current);
    try {
      // Retire known-hidden identities even if the directory response fails first.
      const privacy = readHidden().then(hidden => { if (valid()) rememberHidden(hidden); });
      const [, rows] = await Promise.all([privacy, browseProfiles(50, 0)]);
      if (!valid()) return;
      const visible = rows.filter(r => !hiddenIds.current.has(r.id));
      setPeople(visible);
      void loadCompatiblePeople(5).then(list => {
        if (valid()) setCompatible(list.filter(r => !hiddenIds.current.has(r.id)));
      }).catch(() => { if (valid()) setMatchError(true); });
      void loadPalateMatches(visible.map(p => p.id)).then(next => {
        if (valid()) setMatches(next);
      }).catch(() => { if (valid()) setMatchError(true); });
    } catch {
      if (valid()) { setPeople([]); setError("Couldn't load people safely. Please try again."); }
    } finally {
      if (valid()) setRefreshing(false);
    }
  }, [current, loadFollowing, search, rememberHidden]);

  useFocusEffect(useCallback(() => {
    const view = {};
    active.current = view;
    hiddenIds.current = new Set();
    followingRef.current = null; setFollowing(null); setFollowError(false);
    setMutationErrors({}); setAskDiscovery(false); setBusy([...gates.current]);
    void load();
    void needsDiscoveryPrompt().then(ask => { if (current(view)) setAskDiscovery(ask); }).catch(() => {});
    return () => { if (active.current === view) active.current = null; ++directoryRequest.current; ++searchRequest.current; ++followingRequest.current; };
  }, [load, current]));

  async function toggleFollow(id: string, name: string) {
    const view = active.current;
    if (!current(view) || followingRef.current === null || hiddenIds.current.has(id) || gates.current.has(id)) return;
    const wasFollowing = followingRef.current.has(id);
    gates.current.add(id); pending.current.add(id); ++followingRequest.current;
    setBusy([...gates.current]);
    setMutationErrors(errors => { const next = { ...errors }; delete next[id]; return next; });
    try {
      const result = wasFollowing ? await unfollowUser(id) : await followUser(id);
      if (current(view) && followingRef.current) {
        const next = new Set(followingRef.current);
        if (result === "following" || result === "mutual") next.add(id); else next.delete(id);
        followingRef.current = next; setFollowing(next);
      }
    } catch {
      if (current(view) && !hiddenIds.current.has(id)) setMutationErrors(errors => ({ ...errors, [id]: `Couldn't confirm the change for ${name}. Check the current follow status before trying again.` }));
    } finally {
      pending.current.delete(id);
      if (current(active.current) && pending.current.size === 0) void loadFollowing();
    }
  }
  function openProfile(id: string) {
    if (!current(active.current) || hiddenIds.current.has(id)) return;
    router.push(`/profile/${id}` as never);
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
            onRefresh={() => void load(true)}
          />
        }
      >
        <Text style={styles.lead}>
          Explore public profiles. Available taste matches appear first.
        </Text>

        <View style={styles.searchRow}>
          <TextInput
            value={q}
            onChangeText={(value) => void search(value)}
            accessibilityLabel="Search people"
            placeholder="Search by name, handle or email"
            placeholderTextColor={colors.mute}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
          />
        </View>

        {q.trim().length > 0 && q.trim().length < 3 && <Text style={styles.emptyLine}>Enter at least 3 characters to search.</Text>}
        {searching && <Text accessibilityLiveRegion="polite" style={styles.emptyLine}>Searching…</Text>}
        {searchError && <View><Text accessibilityRole="alert" style={styles.error}>Search unavailable. Please try again.</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry search" onPress={() => void search(query.current)}><Text>Retry search</Text></Pressable></View>}
        {followError && <View><Text accessibilityRole="alert" style={styles.error}>Follow status unavailable. Follow controls are disabled.</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry follow status" onPress={() => void loadFollowing()}><Text>Retry follow status</Text></Pressable></View>}
        {Object.entries(mutationErrors).map(([id, message]) => <Text key={id} accessibilityRole="alert" style={styles.error}>{message}</Text>)}
        {matchError && <Text style={styles.emptyLine}>Some taste matches are unavailable. Pull to refresh.</Text>}

        {hits !== null && (
          <View style={styles.hits}>
            {hits.length === 0 && <Text style={styles.emptyLine}>No matching people found.</Text>}
            {hits.map((h) => (
              <Pressable key={h.id} style={styles.hitRow} onPress={() => openProfile(h.id)}>
                <Avatar uri={h.avatar_url} name={h.display_name} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.compatName} numberOfLines={1}>
                    {h.display_name || (h.username ? `@${h.username}` : "Someone")}
                  </Text>
                  {!!h.username && !!h.display_name && <Text style={styles.handle}>@{h.username}</Text>}
                </View>
                <FollowPill
                  following={following?.has(h.id) ?? false}
                  known={following !== null}
                  name={h.display_name || h.username || "Someone"}
                  busy={busy.includes(h.id)}
                  onPress={() => void toggleFollow(h.id, h.display_name || h.username || "this person")}
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
                onPress={() => openProfile(c.id)}
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
              Review who can see your profile before making it discoverable. Visibility is controlled in Edit profile.
            </Text>
            <View style={styles.askRow}>
              <Pressable
                style={styles.askPrimary}
                accessibilityRole="button"
                accessibilityLabel="Review profile visibility"
                onPress={() => router.push("/edit-profile" as never)}
              >
                <Text style={styles.askPrimaryText}>Review visibility</Text>
              </Pressable>
              <Pressable
                style={styles.askGhost}
                accessibilityRole="button"
                accessibilityLabel="Not now"
                onPress={() => setAskDiscovery(false)}
              >
                <Text style={styles.askGhostText}>Not now</Text>
              </Pressable>
            </View>
          </View>
        )}

        {people === null && (
          <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
        )}

        {!!error && <View><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry people" onPress={() => void load()}><Text>Try again</Text></Pressable></View>}

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
              following={following?.has(p.id) ?? false}
              known={following !== null}
              busy={busy.includes(p.id)}
              onFollow={() => void toggleFollow(p.id, p.display_name || p.username || "this person")}
              onOpen={() => {
                void triggerHapticSelection();
                openProfile(p.id);
              }}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FollowPill({ following, known, busy, name, onPress }: { following: boolean; known: boolean; busy: boolean; name: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={(e) => { e.stopPropagation(); onPress(); }}
      disabled={busy || !known}
      accessibilityLabel={`${known ? following ? "Unfollow" : "Follow" : "Follow status unavailable for"} ${name}`}
      accessibilityState={{ disabled: busy || !known, busy }}
      style={[styles.pill, following && styles.pillGhost]}
      hitSlop={6}
      accessibilityRole="button"
    >
      <Text style={[styles.pillText, following && styles.pillGhostText]}>
        {busy ? "…" : !known ? "Unavailable" : following ? "Following" : "Follow"}
      </Text>
    </Pressable>
  );
}

function PersonTile({
  person, match, following, known, busy, onFollow, onOpen,
}: {
  person: PublicProfile; match?: PalateMatch; following: boolean;
  known: boolean; busy: boolean; onFollow: () => void; onOpen: () => void;
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
      <FollowPill following={following} known={known} busy={busy} name={name} onPress={onFollow} />
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
