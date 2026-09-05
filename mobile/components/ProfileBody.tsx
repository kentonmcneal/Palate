import { useCallback, useEffect, useRef, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Share } from "react-native";
import { Text } from "./Text";
import { useFocusEffect, useRouter } from "expo-router";
import { Avatar } from "./Avatar";
import { TopFive } from "./TopFive";
import { PalateMatches } from "./PalateMatches";
import { SavedNearbyCard } from "./SavedNearbyCard";
import { MatchShareCard } from "./MatchShareCard";
import { colors, spacing, type, shadow, card } from "../theme";
import { getFriendProfileSnapshot, getMyProfile, type FriendProfileSnapshot } from "../lib/profile";
import { captureRef } from "react-native-view-shot";
import { loadSharedPlaces, openInstagram, openTikTok, type SharedPlace } from "../lib/social";
import { loadPalateMatch } from "../lib/palate/pairCompatibility";
import { matchHeadline, type PalateMatch } from "../lib/recommendation/palate-match";
import { requestFriendship, unfriend, acceptFriendship } from "../lib/friends";
import { reportContent, blockUser, unblockUser, isBlocked, REPORT_REASONS } from "../lib/moderation";

/**
 * One profile, rendered the same way whoever is looking.
 *
 * This used to exist twice: `app/profile/[id].tsx` drew other people, and the
 * Settings screen drew a different, richer version of you. Two renderings of
 * the same object drift, and the owner ends up unable to see what anybody else
 * sees. There is now one body; the owner gets extra CONTROLS layered on it, not
 * a different page.
 *
 * The snapshot RPC already returns `is_self` and enforces every visibility rule
 * server-side, so the owner branches here are about affordances only — nothing
 * below decides what data is allowed through.
 */
export function ProfileBody({ targetId }: { targetId: string }) {
  const router = useRouter();

  const [snapshot, setSnapshot] = useState<FriendProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [match, setMatch] = useState<PalateMatch | null>(null);
  const [me, setMe] = useState<{ name: string | null; avatarUrl: string | null } | null>(null);
  const [sharedPlaces, setSharedPlaces] = useState<SharedPlace[]>([]);
  const [blocked, setBlocked] = useState(false);
  const matchCardRef = useRef<View>(null);

  useEffect(() => {
    if (!targetId) return;
    let alive = true;
    void loadSharedPlaces(targetId)
      .then((rows) => alive && setSharedPlaces(rows))
      .catch(() => {});
    return () => { alive = false; };
  }, [targetId]);

  useEffect(() => {
    void getMyProfile()
      .then((p) => p && setMe({ name: p.display_name, avatarUrl: p.avatar_url }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Compatibility is computed for anyone whose profile you can actually see,
    // not just accepted friends — since 0077 that includes every public
    // profile. `friend_taste_features` applies the same gate server-side and
    // returns nothing when it does not hold.
    if (snapshot?.is_self || snapshot?.total_visits === null) return;
    let alive = true;
    loadPalateMatch(targetId)
      .then((m) => alive && setMatch(m))
      .catch(() => {});
    return () => { alive = false; };
  }, [snapshot?.total_visits, snapshot?.is_self, targetId]);

  const load = useCallback(async () => {
    try {
      const [snap, isB] = await Promise.all([
        getFriendProfileSnapshot(targetId),
        isBlocked(targetId),
      ]);
      setSnapshot(snap);
      setBlocked(isB);
    } catch (e: any) {
      console.warn("snapshot load", e?.message);
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
  }, [load]));

  async function shareMatch() {
    if (!matchCardRef.current) return;
    try {
      const uri = await captureRef(matchCardRef, { format: "png", quality: 1 });
      await Share.share({ url: uri });
    } catch {
      Alert.alert("Couldn't share", "Try again in a moment.");
    }
  }

  async function handleAddFriend() {
    setActing(true);
    try {
      await requestFriendship(targetId);
      await load();
    } catch (e: any) {
      Alert.alert("Couldn't add friend", e.message ?? "Try again");
    } finally {
      setActing(false);
    }
  }

  async function handleAcceptFriend() {
    setActing(true);
    try {
      await acceptFriendship(targetId);
      await load();
    } catch (e: any) {
      Alert.alert("Couldn't accept", e.message ?? "Try again");
    } finally {
      setActing(false);
    }
  }

  // Used in alert copy ("Block X?"). Same rule: no email, ever.
  const displayName = snapshot?.display_name
    || (snapshot?.username ? `@${snapshot.username}` : "this person");

  function handleUnfriend() {
    if (!snapshot) return;
    Alert.alert("Remove friend?", displayName, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive",
        onPress: async () => {
          setActing(true);
          try { await unfriend(targetId); await load(); }
          catch (e: any) { Alert.alert("Couldn't remove", e.message ?? "Try again"); }
          finally { setActing(false); }
        },
      },
    ]);
  }

  function handleBlock() {
    Alert.alert(
      `Block ${displayName}?`,
      "You won't see their posts, and you'll be removed as friends.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block", style: "destructive",
          onPress: async () => {
            setActing(true);
            try { await blockUser(targetId); setBlocked(true); await load(); }
            catch (e: any) { Alert.alert("Couldn't block", e?.message ?? "Try again"); }
            finally { setActing(false); }
          },
        },
      ],
    );
  }

  async function handleUnblock() {
    setActing(true);
    try { await unblockUser(targetId); setBlocked(false); }
    catch (e: any) { Alert.alert("Couldn't unblock", e?.message ?? "Try again"); }
    finally { setActing(false); }
  }

  function handleReport() {
    Alert.alert("Report this profile", "Why are you reporting them?", [
      ...REPORT_REASONS.map((r) => ({
        text: r.label,
        onPress: () => reportContent({ targetType: "profile", targetId, targetUserId: targetId, reason: r.key })
          .then(() => Alert.alert("Thanks for flagging", "We'll review this within 24 hours."))
          .catch((e: any) => Alert.alert("Couldn't report", e?.message ?? "Try again")),
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }

  const mine = Boolean(snapshot?.is_self);
  // Whether this viewer is allowed to see profile CONTENT, as opposed to bare
  // identity. The RPC is the authority: it nulls every content column when the
  // answer is no, so asking the data beats re-deriving the rule here and
  // getting a different answer than the server did.
  const canSee = mine || (snapshot != null && snapshot.total_visits !== null);
  // Twelve of fourteen accounts have logged nothing. Those profiles rendered
  // "No persona yet" stacked above a stats card reading 0 and 0 — two cards
  // agreeing that there is nothing, which is worse than one saying so.
  const noHistory = canSee && (snapshot?.total_visits ?? 0) === 0;

  return (
    <>
      <ScrollView contentContainerStyle={styles.body}>
        {loading && (
          <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
        )}

        {!loading && !snapshot && (
          <View style={styles.empty}>
            <Text style={type.subtitle}>Profile not found.</Text>
          </View>
        )}

        {!loading && snapshot && (
          <>
            {/* Identity card */}
            <View style={styles.idCard}>
              <Avatar uri={snapshot.avatar_url} name={snapshot.display_name} size={80} />
              {/* Identity is name, then handle. Never the login address: it used
                  to be both the fallback name and a line of its own, which put
                  every user's email on a screen any other user could open. */}
              <Text style={styles.name}>
                {snapshot.display_name
                  || (snapshot.username ? `@${snapshot.username}` : "Someone")}
              </Text>
              {!!snapshot.username && !!snapshot.display_name && (
                <Text style={[type.small, { marginTop: 4 }]}>@{snapshot.username}</Text>
              )}
              {snapshot.is_friend && !mine && (
                <View style={styles.friendBadge}>
                  <Text style={styles.friendBadgeText}>✓ Friends</Text>
                </View>
              )}

              {/* Profile content. The RPC returns these as null for a private
                  profile and for a friends-only profile seen by a non-friend,
                  so there is nothing to gate here — absent means not allowed. */}
              {!!snapshot.bio && <Text style={styles.bio}>{snapshot.bio}</Text>}
              {!!(snapshot.school || snapshot.current_city) && (
                <Text style={styles.meta}>
                  {[snapshot.school, snapshot.current_city].filter(Boolean).join(" · ")}
                </Text>
              )}
              {!!(snapshot.instagram_handle || snapshot.tiktok_handle) && (
                <View style={styles.socialRow}>
                  {!!snapshot.instagram_handle && (
                    <Pressable
                      onPress={() => void openInstagram(snapshot.instagram_handle!)}
                      style={styles.socialChip}
                      accessibilityRole="link"
                    >
                      <Text style={styles.socialChipText}>Instagram</Text>
                    </Pressable>
                  )}
                  {!!snapshot.tiktok_handle && (
                    <Pressable
                      onPress={() => void openTikTok(snapshot.tiktok_handle!)}
                      style={styles.socialChip}
                      accessibilityRole="link"
                    >
                      <Text style={styles.socialChipText}>TikTok</Text>
                    </Pressable>
                  )}
                </View>
              )}

              {/* Owner controls. Editing lives on the profile, not three taps
                  away in Settings — you should be able to change the thing you
                  are looking at. */}
              {mine && (
                <View style={styles.ownerRow}>
                  <Pressable
                    onPress={() => router.push("/edit-profile" as never)}
                    style={styles.ownerBtn}
                    accessibilityRole="button"
                  >
                    <Text style={styles.ownerBtnText}>Edit profile</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => router.push("/curate-profile" as never)}
                    style={styles.ownerBtn}
                    accessibilityRole="button"
                  >
                    <Text style={styles.ownerBtnText}>Choose what friends see</Text>
                  </Pressable>
                </View>
              )}
            </View>

            {/* Visibility-gated body. A null persona means one of two very
                different things — DON'T show "private" to an accepted friend
                who simply hasn't been classified yet (in week 1 nobody has a
                persona, so every friend would otherwise read as private). */}
            {snapshot.persona_label === null && !mine && !noHistory && (
              canSee ? (
                <View style={styles.privateCard}>
                  <Text style={type.subtitle}>No persona yet.</Text>
                  <Text style={[type.small, { marginTop: 6, lineHeight: 20 }]}>
                    They need a few more visits before their weekly Palate shows up here.
                  </Text>
                </View>
              ) : (
                <View style={styles.privateCard}>
                  <Text style={type.subtitle}>This profile is private.</Text>
                  <Text style={[type.small, { marginTop: 6, lineHeight: 20 }]}>
                    {snapshot.profile_visibility === "private"
                      ? "They've set their profile to private. You can still send a friend request."
                      : "Add them as a friend to see their persona, top spots, and more."}
                  </Text>
                </View>
              )
            )}

            {noHistory && (
              <View style={styles.privateCard}>
                <Text style={type.subtitle}>
                  {mine ? "No visits yet." : "They haven't logged anything yet."}
                </Text>
                <Text style={[type.small, { marginTop: 6, lineHeight: 20 }]}>
                  {mine
                    ? "Turn on tracking and your visits collect themselves. Your palate, top spots and Wrapped all build from them."
                    : "Their palate and top spots will show up here once they start eating out."}
                </Text>
              </View>
            )}

            {!noHistory && snapshot.persona_label && (
              <View style={styles.personaCard}>
                <Text style={styles.personaEyebrow}>LATEST PERSONA</Text>
                <Text style={styles.personaLabel}>{snapshot.persona_label}</Text>
                {snapshot.persona_tagline && (
                  <Text style={styles.personaTagline}>"{snapshot.persona_tagline}"</Text>
                )}
              </View>
            )}

            {!noHistory && snapshot.total_visits !== null && (
              <View style={styles.statsCard}>
                <Text style={[type.micro, { marginBottom: 12 }]}>BY THE NUMBERS</Text>
                <View style={styles.statsRow}>
                  <Stat label="Visits" value={String(snapshot.total_visits)} />
                  {snapshot.unique_restaurants !== null && (
                    <Stat label="Spots" value={String(snapshot.unique_restaurants)} />
                  )}
                </View>
                {snapshot.top_restaurant && (
                  <View style={styles.topSpot}>
                    <Text style={[type.micro, { marginBottom: 6 }]}>MOST-VISITED SPOT</Text>
                    <Text style={styles.topSpotName}>{snapshot.top_restaurant}</Text>
                  </View>
                )}
                {/* These are the numbers a FRIEND sees, for the owner too — the
                    profile is a preview, not a private dashboard. The hidden
                    remainder is disclosed rather than folded in, so nobody
                    discovers later that curating quietly shrank their stats. */}
                {mine && snapshot.hidden_visits !== null && snapshot.hidden_visits > 0 && (
                  <Pressable
                    onPress={() => router.push("/curate-profile" as never)}
                    style={styles.hiddenNote}
                    accessibilityRole="button"
                  >
                    <Text style={styles.hiddenNoteText}>
                      {snapshot.hidden_visits} more {snapshot.hidden_visits === 1 ? "visit is" : "visits are"} in
                      your private history and not counted here.
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* The ranked list is an identity object, so it belongs on the
                profile for everyone — including you. */}
            {canSee && !noHistory && (
              <TopFive userId={targetId} mine={mine} displayName={snapshot.display_name} />
            )}

            <PalateMatches userId={targetId} mine={mine} displayName={snapshot.display_name} />

            {/* Owner-only tail. Saved places and the full insights breakdown
                are yours alone — they are not part of what a friend sees, so
                they sit below everything that is. */}
            {mine && (
              <>
                {/* Visit history lives here rather than on the tab bar. */}
                <Pressable
                  onPress={() => router.push("/(tabs)/visits" as never)}
                  style={styles.historyBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.historyTitle}>Your visits</Text>
                  <Text style={styles.historySub}>
                    {snapshot.total_visits !== null
                      ? `Every meal you've logged${
                          snapshot.hidden_visits ? `, including ${snapshot.hidden_visits} hidden` : ""
                        } →`
                      : "Every meal you've logged →"}
                  </Text>
                </Pressable>
                <SavedNearbyCard />
                <Pressable
                  onPress={() => router.push("/insights" as never)}
                  style={styles.insightsBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.insightsText}>See full insights →</Text>
                </Pressable>
              </>
            )}

            {canSee && !mine && (
              <>
                {/* The number IS the object — one figure, reasons underneath.
                    A link labelled "see your compatibility" asks the user to
                    go find out; showing it asks nothing. See SOCIAL_DESIGN.md. */}
                {match && (
                  <View style={styles.matchHero}>
                    {match.ready ? (
                      <>
                        <Text style={styles.matchNumber}>{match.score}%</Text>
                        <Text style={styles.matchLabel}>
                          {matchHeadline(match, snapshot.display_name || "they")}
                        </Text>
                        {match.reasons.slice(0, 3).map((r) => (
                          <Text key={r.kind} style={styles.matchReason}>· {r.label}</Text>
                        ))}
                      </>
                    ) : (
                      <>
                        <Text style={styles.matchLocked}>Palate match locked</Text>
                        <Text style={styles.matchReason}>
                          {matchHeadline(match, snapshot.display_name || "they")}
                        </Text>
                      </>
                    )}
                  </View>
                )}

                {sharedPlaces.length > 0 && (
                  <View style={styles.sharedBox}>
                    <Text style={styles.sharedTitle}>
                      You&apos;ve both been to {sharedPlaces.length} of the same place{sharedPlaces.length === 1 ? "" : "s"}
                    </Text>
                    {sharedPlaces.slice(0, 5).map((sp) => (
                      <Pressable
                        key={sp.google_place_id}
                        onPress={() => router.push(`/restaurant/${sp.google_place_id}` as never)}
                        style={styles.sharedRow}
                        accessibilityRole="button"
                      >
                        <Text style={styles.sharedName} numberOfLines={1}>{sp.name}</Text>
                        <Text style={styles.sharedCount}>
                          {sp.my_visits}&nbsp;·&nbsp;{sp.their_visits}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {match?.ready && (
                  <Pressable onPress={shareMatch} style={styles.shareBtn} accessibilityRole="button">
                    <Text style={styles.shareBtnText}>Share this match</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => router.push(`/compatibility/${targetId}` as never)}
                  style={styles.compatBtn}
                >
                  <Text style={styles.compatBtnText}>See the full breakdown  →</Text>
                </Pressable>
              </>
            )}

            {/* Actions */}
            {!mine && (
              <View style={{ marginTop: spacing.xl, gap: 12 }}>
                {/* Four states, not two. A request you have SENT used to render
                    the same "Add friend" button as one you had never sent,
                    because is_friend only ever meant accepted — so the tap
                    looked like it had done nothing, and the obvious response
                    is to tap it again. */}
                {!blocked && (
                  snapshot.friend_state === "accepted" ? (
                    <Pressable onPress={handleUnfriend} disabled={acting} style={styles.btnGhost}>
                      <Text style={styles.btnGhostText}>{acting ? "…" : "Remove friend"}</Text>
                    </Pressable>
                  ) : snapshot.friend_state === "pending_in" ? (
                    <Pressable onPress={handleAcceptFriend} disabled={acting} style={styles.btnPrimary}>
                      <Text style={styles.btnPrimaryText}>
                        {acting ? "…" : `Accept ${snapshot.display_name || "request"}`}
                      </Text>
                    </Pressable>
                  ) : snapshot.friend_state === "pending_out" ? (
                    <View style={styles.btnGhost}>
                      <Text style={styles.btnGhostText}>Request sent</Text>
                    </View>
                  ) : (
                    <Pressable onPress={handleAddFriend} disabled={acting} style={styles.btnPrimary}>
                      <Text style={styles.btnPrimaryText}>{acting ? "…" : "Add friend"}</Text>
                    </Pressable>
                  )
                )}

                <View style={styles.safetyRow}>
                  <Pressable onPress={handleReport} disabled={acting} hitSlop={8}>
                    <Text style={styles.safetyText}>Report</Text>
                  </Pressable>
                  <Text style={styles.safetyDot}>·</Text>
                  {blocked ? (
                    <Pressable onPress={handleUnblock} disabled={acting} hitSlop={8}>
                      <Text style={styles.safetyText}>Unblock</Text>
                    </Pressable>
                  ) : (
                    <Pressable onPress={handleBlock} disabled={acting} hitSlop={8}>
                      <Text style={[styles.safetyText, { color: colors.redText }]}>Block</Text>
                    </Pressable>
                  )}
                </View>
                {blocked && (
                  <Text style={[type.small, { textAlign: "center", lineHeight: 18 }]}>
                    You've blocked {displayName}. They can't appear in your feed.
                  </Text>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Off-screen render target for the share capture. Positioned far off
          the left edge rather than hidden — a display:none subtree has no
          layout, so ViewShot would capture nothing. */}
      {match?.ready && snapshot && (
        <View style={styles.offscreen} pointerEvents="none">
          <View ref={matchCardRef} collapsable={false}>
            <MatchShareCard
              match={match}
              you={{ name: me?.name ?? "You", avatarUrl: me?.avatarUrl ?? null }}
              them={{ name: snapshot.display_name, avatarUrl: snapshot.avatar_url }}
            />
          </View>
        </View>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, paddingBottom: 80 },
  center: { padding: 60, alignItems: "center" },
  empty: { padding: spacing.lg, borderRadius: 18, borderWidth: 1, borderColor: colors.line },

  idCard: {
    alignItems: "center",
    padding: spacing.lg,
    borderRadius: 24,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  name: { fontSize: 24, fontWeight: "800", color: colors.ink, marginTop: 14, letterSpacing: -0.4 },
  friendBadge: {
    marginTop: 12,
    paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.red,
  },
  friendBadgeText: { color: colors.red, fontSize: 12, fontWeight: "800" },

  ownerRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 16 },
  ownerBtn: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line,
  },
  ownerBtnText: { fontSize: 13, fontWeight: "700", color: colors.ink },

  privateCard: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: 18,
    borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.paper,
  },

  personaCard: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: 22,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  personaEyebrow: { color: colors.mute, fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  personaLabel: { color: colors.red, fontSize: 28, fontWeight: "800", letterSpacing: -0.6, marginTop: 10, lineHeight: 32 },
  personaTagline: { color: colors.inkDim, fontSize: 14, fontStyle: "italic", marginTop: 4 },

  statsCard: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: 22,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.line,
  },
  statsRow: { flexDirection: "row", gap: 12 },
  stat: {
    flex: 1,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.faint,
  },
  statValue: { fontSize: 28, fontWeight: "800", color: colors.ink, letterSpacing: -1 },
  statLabel: { ...type.small, marginTop: 4 },
  topSpot: {
    marginTop: 16,
    paddingTop: 16,
    borderTopColor: colors.line, borderTopWidth: 1,
  },
  topSpotName: { fontSize: 18, fontWeight: "700", color: colors.ink },
  hiddenNote: {
    marginTop: 14, paddingTop: 14,
    borderTopColor: colors.line, borderTopWidth: 1,
  },
  hiddenNoteText: { ...type.small, lineHeight: 19 },
  historyBtn: {
    marginTop: spacing.xl, padding: spacing.lg, borderRadius: 22,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  historyTitle: { fontSize: 18, fontWeight: "800", color: colors.ink, letterSpacing: -0.3 },
  historySub: { ...type.small, marginTop: 4 },
  wrappedBtn: {
    marginTop: spacing.xl, padding: spacing.lg, borderRadius: 22,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  wrappedTitle: { fontSize: 18, fontWeight: "800", color: colors.ink, letterSpacing: -0.3 },
  wrappedSub: { ...type.small, marginTop: 4 },
  insightsBtn: { marginTop: spacing.lg, paddingVertical: 12, alignItems: "center" },
  insightsText: { fontSize: 14, fontWeight: "700", color: colors.red },

  btnPrimary: {
    paddingVertical: 14, borderRadius: 999,
    backgroundColor: colors.red,
    alignItems: "center", justifyContent: "center",
  },
  btnPrimaryText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  btnGhost: {
    paddingVertical: 14, borderRadius: 999,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
    alignItems: "center", justifyContent: "center",
  },
  btnGhostText: { color: colors.mute, fontSize: 16, fontWeight: "700" },

  bio: { ...type.body, color: colors.inkDim, textAlign: "center", marginTop: 10, lineHeight: 21 },
  meta: { ...type.small, marginTop: 6 },
  socialRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  socialChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line,
  },
  socialChipText: { fontSize: 13, fontWeight: "700", color: colors.ink },
  sharedBox: { marginTop: spacing.lg, width: "100%" },
  sharedTitle: { fontSize: 15, fontWeight: "800", color: colors.ink, marginBottom: 8 },
  sharedRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 12,
  },
  sharedName: { flex: 1, fontSize: 15, color: colors.ink, fontWeight: "600" },
  sharedCount: { ...type.small, fontVariant: ["tabular-nums"] },
  offscreen: { position: "absolute", left: -9999, top: 0 },
  shareBtn: {
    marginTop: 10, paddingVertical: 12, borderRadius: 999,
    backgroundColor: colors.red, alignItems: "center",
  },
  shareBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  matchHero: {
    marginTop: spacing.lg,
    alignItems: "center",
    paddingVertical: spacing.lg,
    borderRadius: card.radius,
    backgroundColor: colors.faint,
    ...shadow.card,
  },
  matchNumber: { ...type.display, fontSize: 44, lineHeight: 50, color: colors.redText },
  matchLabel: { ...type.subtitle, marginTop: 2, marginBottom: 8, color: colors.ink },
  matchLocked: { ...type.subtitle, color: colors.ink },
  matchReason: { ...type.small, marginTop: 2 },
  compatBtn: {
    marginTop: spacing.xl,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  compatBtnText: { color: "#fff", fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },

  safetyRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  safetyText: { color: colors.mute, fontSize: 14, fontWeight: "600" },
  safetyDot: { color: colors.line, fontSize: 14 },
});
