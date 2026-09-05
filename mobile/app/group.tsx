import { useCallback, useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Avatar } from "../components/Avatar";
import { Button, Spacer } from "../components/Button";
import { colors, spacing, type, card, radius, shadow } from "../theme";
import { listFriends, type FriendListItem } from "../lib/friends";
import { loadGroupRecs, groupEmptyReason, type GroupPick } from "../lib/group-recs";
import { getEffectiveLocation } from "../lib/browsing-location";
import { triggerHapticSelection } from "../lib/haptics";
import { captureError } from "../lib/observability";
import { openInAppleMaps } from "../lib/maps";

// ============================================================================
// group — "best restaurant for everybody".
// ----------------------------------------------------------------------------
// Picking where to eat as a group is social friction, and the useful thing an
// app can be there is the neutral party. That only works if the answer is
// AUDITABLE, which is why every pick shows what it scored for each person
// rather than just asserting a winner.
//
// Ranked by MINIMAX, computed server-side (supabase/functions/group-recs):
// a place is judged by its least-happy member, because "best for everybody"
// means nobody has a bad night. Averaging would pick the blandest option in
// range — the place nobody objects to is not the place anybody wanted.
//
// Candidates come only from restaurants we already know. The function never
// calls Google, so an unexplored area honestly returns nothing.
// ============================================================================

const MAX_OTHERS = 3; // plus you = 4

export default function GroupScreen() {
  const router = useRouter();
  const [friends, setFriends] = useState<FriendListItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picks, setPicks] = useState<GroupPick[] | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [vetoed, setVetoed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listFriends()
      .then(setFriends)
      .catch((e) => { void captureError(e, { at: "group:friends" }); setFriends([]); });
  }, []);

  const nameFor = useCallback((id: string) => {
    const f = friends?.find((x) => x.friend.id === id);
    return f?.friend.display_name || f?.friend.username || "Friend";
  }, [friends]);

  function toggle(id: string) {
    void triggerHapticSelection();
    setPicks(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_OTHERS) next.add(id);
      return next;
    });
  }

  async function find() {
    setBusy(true);
    setError(null);
    setPicks(null);
    try {
      const here = await getEffectiveLocation();
      if (!here) {
        setError("We need your location to find somewhere for everyone.");
        return;
      }
      const res = await loadGroupRecs({
        memberIds: [...selected],
        lat: here.lat,
        lng: here.lng,
      });
      setPicks(res.picks);
      setReason(res.reason ?? null);
      setVetoed(res.vetoed ?? 0);
    } catch (e: unknown) {
      void captureError(e, { at: "group:find" });
      setError("Couldn't work that out. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Eating together</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.lead}>
          Pick up to {MAX_OTHERS} friends. We&apos;ll find the place that works
          best for whoever would like it least.
        </Text>

        {friends === null && <ActivityIndicator style={{ marginTop: 20 }} color={colors.red} />}

        {friends?.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyGlyph}>◎</Text>
            <Text style={styles.emptyLine}>Add a friend first. This needs at least two palates.</Text>
          </View>
        )}

        {!!friends?.length && (
          <View style={styles.chips}>
            {friends.filter((f) => f.friend?.id).map((f) => {
              const on = selected.has(f.friend.id);
              const full = !on && selected.size >= MAX_OTHERS;
              return (
                <Pressable
                  key={f.friend.id}
                  onPress={() => toggle(f.friend.id)}
                  disabled={full}
                  style={[styles.chip, on && styles.chipOn, full && styles.chipDim]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                >
                  <Avatar uri={f.friend.avatar_url} name={f.friend.display_name} email={f.friend.email} size={24} />
                  <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                    {f.friend.display_name || f.friend.username || "Friend"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {selected.size > 0 && (
          <>
            <Spacer size={16} />
            <Button
              title={busy ? "Working it out…" : `Find somewhere for ${selected.size + 1}`}
              onPress={find}
              loading={busy}
            />
          </>
        )}

        {!!error && <Text style={styles.error}>{error}</Text>}

        {picks !== null && picks.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyGlyph}>◎</Text>
            <Text style={styles.emptyLine}>{groupEmptyReason(reason)}</Text>
          </View>
        )}

        {!!picks?.length && (
          <>
            <Spacer size={20} />
            <Text style={styles.sectionHead}>Best for everyone</Text>
            {vetoed > 0 && (
              // Naming the veto is the point. "We ruled out 12 places one of
              // you would have hated" is why the shortlist is short.
              <Text style={styles.vetoNote}>
                Ruled out {vetoed} place{vetoed === 1 ? "" : "s"} at least one of you wouldn&apos;t have wanted.
              </Text>
            )}
            {picks.map((p, i) => (
              <PickCard key={p.google_place_id} pick={p} rank={i + 1} nameFor={nameFor} onOpen={() => {
                void triggerHapticSelection();
                router.push(`/restaurant/${p.google_place_id}` as never);
              }} />
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PickCard({
  pick, rank, nameFor, onOpen,
}: { pick: GroupPick; rank: number; nameFor: (id: string) => string; onOpen: () => void }) {
  return (
    <Pressable style={styles.pick} onPress={onOpen} accessibilityRole="button">
      <View style={styles.pickHead}>
        <Text style={styles.rank}>{rank}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.pickName} numberOfLines={2}>{pick.name}</Text>
          <Text style={styles.pickMeta}>
            {[pick.cuisine, pick.neighborhood].filter(Boolean).join(" · ") || "Nearby"}
          </Text>
        </View>
        <View style={styles.scoreChip}>
          <Text style={styles.scoreChipText}>{pick.group_score}</Text>
          <Text style={styles.scoreChipLabel}>worst case</Text>
        </View>
      </View>

      {/* The audit trail. A group pick people can check is a group pick people
          accept — and it is the thing that makes the app the neutral party
          rather than another opinion. */}
      <View style={styles.perMember}>
        {pick.per_member.map((m, i) => (
          <Text key={m.user_id} style={styles.perMemberText}>
            {i === 0 ? "You" : nameFor(m.user_id)} {m.score}
            {i < pick.per_member.length - 1 ? "  ·  " : ""}
          </Text>
        ))}
      </View>

      <Pressable
        onPress={(e) => { e.stopPropagation(); openInAppleMaps(pick.name, {}); }}
        style={styles.mapsBtn}
        accessibilityRole="button"
      >
        <Text style={styles.mapsBtnText}>Maps</Text>
      </Pressable>
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
  lead: { ...type.small, lineHeight: 19, marginBottom: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 10, minHeight: 40, paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipDim: { opacity: 0.4 },
  chipText: { fontSize: 13, fontWeight: "700", color: colors.ink, maxWidth: 140 },
  chipTextOn: { color: "#fff" },
  error: { ...type.small, color: colors.redText, marginTop: spacing.md },
  empty: { alignItems: "center", paddingVertical: spacing.xl, gap: 8 },
  emptyGlyph: { fontSize: 22, color: colors.line },
  emptyLine: { ...type.small, textAlign: "center", maxWidth: 280, lineHeight: 19 },
  sectionHead: { fontSize: 18, fontWeight: "800", color: colors.ink, marginBottom: 4 },
  vetoNote: { ...type.small, marginBottom: 10 },
  pick: {
    padding: card.padding, borderRadius: card.radius,
    backgroundColor: colors.faint, marginBottom: 10, ...shadow.card,
  },
  pickHead: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  rank: { ...type.title, color: colors.mute, minWidth: 22, textAlign: "center" },
  pickName: { fontSize: 16, fontWeight: "800", color: colors.ink },
  pickMeta: { ...type.small, marginTop: 2 },
  scoreChip: {
    alignItems: "center", paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.md, backgroundColor: colors.redTint,
    borderWidth: 1, borderColor: colors.redTintBorder,
  },
  scoreChipText: { fontSize: 18, fontWeight: "800", color: colors.redText },
  scoreChipLabel: { fontSize: 9, fontWeight: "700", color: colors.mute, letterSpacing: 0.4 },
  perMember: { flexDirection: "row", flexWrap: "wrap", marginTop: 12 },
  perMemberText: { ...type.small, color: colors.inkDim, fontWeight: "600" },
  mapsBtn: {
    alignSelf: "flex-start", marginTop: 12,
    paddingHorizontal: 12, minHeight: 36, paddingVertical: 8,
    borderRadius: radius.full, backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.line, justifyContent: "center",
  },
  mapsBtnText: { fontSize: 13, fontWeight: "700", color: colors.ink },
});
