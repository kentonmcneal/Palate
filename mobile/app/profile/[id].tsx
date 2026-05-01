import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Spacer } from "../../components/Button";
import { Avatar } from "../../components/Avatar";
import { colors, spacing, type } from "../../theme";
import { getFriendProfileSnapshot, type FriendProfileSnapshot } from "../../lib/profile";
import { requestFriendship, unfriend } from "../../lib/friends";

export default function FriendProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const targetId = id as string;

  const [snapshot, setSnapshot] = useState<FriendProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      setSnapshot(await getFriendProfileSnapshot(targetId));
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
            </View>

            {/* Visibility-gated body */}
            {snapshot.persona_label === null && !snapshot.is_self && (
              <View style={styles.privateCard}>
                <Text style={type.subtitle}>This profile is private.</Text>
                <Text style={[type.small, { marginTop: 6, lineHeight: 20 }]}>
                  {snapshot.profile_visibility === "private"
                    ? "They've set their profile to private. You can still send a friend request."
                    : "Add them as a friend to see their persona, top spots, and more."}
                </Text>
              </View>
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

            {/* Actions */}
            {!snapshot.is_self && (
              <View style={{ marginTop: spacing.xl }}>
                {snapshot.is_friend ? (
                  <Pressable onPress={handleUnfriend} disabled={acting} style={styles.btnGhost}>
                    <Text style={styles.btnGhostText}>{acting ? "…" : "Remove friend"}</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={handleAddFriend} disabled={acting} style={styles.btnPrimary}>
                    <Text style={styles.btnPrimaryText}>{acting ? "…" : "Add friend"}</Text>
                  </Pressable>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
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
    backgroundColor: colors.ink,
    overflow: "hidden",
  },
  personaEyebrow: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  personaLabel: { color: colors.red, fontSize: 28, fontWeight: "800", letterSpacing: -0.6, marginTop: 10, lineHeight: 32 },
  personaTagline: { color: "rgba(255,255,255,0.85)", fontSize: 14, fontStyle: "italic", marginTop: 4 },

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
});
