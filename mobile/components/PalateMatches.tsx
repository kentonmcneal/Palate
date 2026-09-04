import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Avatar } from "./Avatar";
import { colors, spacing, type } from "../theme";
import { loadPalateMatches, type PalateMatchPeer } from "../lib/profile";

/**
 * The people module. A top-five of RESTAURANTS barely changes month to month,
 * so it is not a reason to reopen the app; a short list of PEOPLE, recomputed
 * from what you both actually did, is. That is the Snapchat Best Friends
 * property, and this is the version of it that does not turn into a standing:
 *
 *   - no numbers anywhere, so there is nothing to compare or screenshot
 *   - order is not stated, so nobody is anyone's "number one"
 *   - reciprocal and friends-only, both enforced in the RPC (0074)
 *
 * It says "keep landing at the same places" and not "eat together", because
 * Palate cannot establish that two people shared a meal — group selections are
 * never persisted, so all we honestly have is overlap.
 *
 * Renders nothing when there are no matches. An empty state here would be an
 * announcement that nobody overlaps with you, which is the one message this
 * module must never send.
 */
export function PalateMatches({
  userId,
  mine,
  displayName,
}: {
  userId: string;
  mine: boolean;
  displayName?: string | null;
}) {
  const router = useRouter();
  const [peers, setPeers] = useState<PalateMatchPeer[]>([]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void loadPalateMatches(userId)
      .then((rows) => alive && setPeers(rows))
      .catch(() => {});
    return () => { alive = false; };
  }, [userId]);

  if (peers.length === 0) return null;

  const who = mine ? "You" : (displayName || "They");

  return (
    <View style={styles.card}>
      <Text style={type.micro}>PALATE MATCHES</Text>
      <Text style={styles.headline}>
        {who} keep landing at the same places as these {peers.length === 1 ? "friend" : "friends"}.
      </Text>

      {peers.map((peer) => (
        <Pressable
          key={peer.id}
          onPress={() => router.push(`/profile/${peer.id}` as never)}
          style={styles.row}
          accessibilityRole="button"
          accessibilityLabel={`Open ${peer.display_name ?? "profile"}`}
        >
          <Avatar uri={peer.avatar_url} name={peer.display_name} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>
              {peer.display_name || (peer.username ? `@${peer.username}` : "Someone")}
            </Text>
            {!!peer.shared_place && (
              <Text style={styles.place} numberOfLines={1}>
                Both of you at {peer.shared_place}
              </Text>
            )}
          </View>
          <Text style={styles.chev}>→</Text>
        </Pressable>
      ))}

      {mine && (
        <Text style={styles.footnote}>
          Only your friends can see this, and only when it goes both ways.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: 22,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  headline: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.ink,
    letterSpacing: -0.3,
    marginTop: 8,
    lineHeight: 23,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink },
  place: { ...type.small, marginTop: 2 },
  chev: { color: colors.mute, fontSize: 16, fontWeight: "700" },
  footnote: { ...type.small, marginTop: 12, lineHeight: 18 },
});
