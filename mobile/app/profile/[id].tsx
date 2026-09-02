import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Linking, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Spacer } from "../../components/Button";
import { Avatar } from "../../components/Avatar";
import { colors, spacing, type, shadow, card } from "../../theme";
import { getFriendProfileSnapshot, getMyProfile, type FriendProfileSnapshot } from "../../lib/profile";
import { captureRef } from "react-native-view-shot";
import { MatchShareCard } from "../../components/MatchShareCard";
import { loadSharedPlaces, type SharedPlace } from "../../lib/social";
import { loadPalateMatch } from "../../lib/palate/pairCompatibility";
import { instagramUrl, tiktokUrl } from "../../lib/social";
import { matchHeadline, type PalateMatch } from "../../lib/recommendation/palate-match";
import { requestFriendship, unfriend } from "../../lib/friends";
import { reportContent, blockUser, unblockUser, isBlocked, REPORT_REASONS } from "../../lib/moderation";

export default function FriendProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const targetId = id as string;

  const [snapshot, setSnapshot] = useState<FriendProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [match, setMatch] = useState<PalateMatch | null>(null);
  const [me, setMe] = useState<{ name: string | null; avatarUrl: string | null } | null>(null);
  const [sharedPlaces, setSharedPlaces] = useState<SharedPlace[]>([]);
  useEffect(() => {
    if (!targetId) return;
    let alive = true;
    void loadSharedPlaces(targetId)
      .then((rows) => alive && setSharedPlaces(rows))
      .catch(() => {});
    return () => { alive = false; };
  }, [targetId]);
  const matchCardRef = useRef<View>(null);

  useEffect(() => {
    void getMyProfile()
      .then((p) => p && setMe({ name: p.display_name, avatarUrl: p.avatar_url }))
      .catch(() => {});
  }, []);

  async function shareMatch() {
    if (!matchCardRef.current) return;
    try {
      const uri = await captureRef(matchCardRef, { format: "png", quality: 1 });
      await Share.share({ url: uri });
    } catch (e: unknown) {
      Alert.alert("Couldn't share", "Try again in a moment.");
    }
  }
  useEffect(() => {
    if (!snapshot?.is_friend || snapshot?.is_self) return;
    let alive = true;
    loadPalateMatch(targetId)
      .then((m) => alive && setMatch(m))
      .catch(() => {});
    return () => { alive = false; };
  }, [snapshot?.is_friend, snapshot?.is_self, targetId]);
  const [blocked, setBlocked] = useState(false);

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

  function handleUnfriend() {
    if (!snapshot) return;
    Alert.alert(
      "Remove friend?",
      snapshot.display_name || snapshot.email || "this friend",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove", style: "destructive",
          onPress: async () => {
            setActing(true);
            try {
              await unfriend(targetId);
              await load();
            } catch (e: any) {
              Alert.alert("Couldn't remove", e.message ?? "Try again");
            } finally {
              setActing(false);
            }
          },
        },
      ],
    );
  }

  const displayName = snapshot?.display_name || snapshot?.email || "this person";

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

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Profile</Text>
        <View style={{ width: 40 }} />
      </View>

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
              <Avatar uri={snapshot.avatar_url} name={snapshot.display_name} email={snapshot.email} size={80} />
              <Text style={styles.name}>
                {snapshot.display_name ||
                  (snapshot.email ? snapshot.email.split("@")[0] : "Unknown")}
              </Text>
              {snapshot.email && (
                <Text style={[type.small, { marginTop: 4 }]}>{snapshot.email}</Text>
              )}
              {snapshot.is_friend && (
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
                      onPress={() => void Linking.openURL(instagramUrl(snapshot.instagram_handle!))}
                      style={styles.socialChip}
                      accessibilityRole="link"
                    >
                      <Text style={styles.socialChipText}>Instagram</Text>
                    </Pressable>
                  )}
                  {!!snapshot.tiktok_handle && (
                    <Pressable
                      onPress={() => void Linking.openURL(tiktokUrl(snapshot.tiktok_handle!))}
                      style={styles.socialChip}
                      accessibilityRole="link"
                    >
                      <Text style={styles.socialChipText}>TikTok</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>

            {/* Visibility-gated body. A null persona means one of two very
                different things — DON'T show "private" to an accepted friend
                who simply hasn't been classified yet (in week 1 nobody has a
                persona, so every friend would otherwise read as private). */}
            {snapshot.persona_label === null && !snapshot.is_self && (
              snapshot.is_friend ? (
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

            {snapshot.persona_label && (
              <View style={styles.personaCard}>
                <Text style={styles.personaEyebrow}>LATEST PERSONA</Text>
                <Text style={styles.personaLabel}>{snapshot.persona_label}</Text>
                {snapshot.persona_tagline && (
                  <Text style={styles.personaTagline}>"{snapshot.persona_tagline}"</Text>
                )}
              </View>
            )}

            {snapshot.total_visits !== null && (
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
                    <Text style={[type.micro, { marginBottom: 6 }]}>MOST RECENT TOP SPOT</Text>
                    <Text style={styles.topSpotName}>{snapshot.top_restaurant}</Text>
                  </View>
                )}
              </View>
            )}

            {snapshot.is_friend && !snapshot.is_self && (
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
            {!snapshot.is_self && (
              <View style={{ marginTop: spacing.xl, gap: 12 }}>
                {!blocked && (snapshot.is_friend ? (
                  <Pressable onPress={handleUnfriend} disabled={acting} style={styles.btnGhost}>
                    <Text style={styles.btnGhostText}>{acting ? "…" : "Remove friend"}</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={handleAddFriend} disabled={acting} style={styles.btnPrimary}>
                    <Text style={styles.btnPrimaryText}>{acting ? "…" : "Add friend"}</Text>
                  </Pressable>
                ))}

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
    </SafeAreaView>
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
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.line, borderBottomWidth: 1,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.faint,
  },
  closeText: { fontSize: 18, fontWeight: "700", color: colors.ink },
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
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.red,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 32, fontWeight: "800" },
  name: { fontSize: 24, fontWeight: "800", color: colors.ink, marginTop: 14, letterSpacing: -0.4 },
  friendBadge: {
    marginTop: 12,
    paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.red,
  },
  friendBadgeText: { color: colors.red, fontSize: 12, fontWeight: "800" },

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
