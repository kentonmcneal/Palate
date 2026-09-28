import { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "./Text";
import { Avatar } from "./Avatar";
import { colors, spacing, type } from "../theme";
import {
  friendsCities, groupByFriend, cityLabel, whenLabel,
  type FriendCityGroup,
} from "../lib/friends-cities";

// ============================================================================
// FriendsInCities — "Ada was in New York this month."
// ----------------------------------------------------------------------------
// Renders nothing at all when there is nothing to say. A section header over an
// empty list is a promise the product has not kept yet, and with two users most
// of the time there genuinely is nothing — better silence than a permanent
// "no friends travelling" sitting on the screen.
//
// City grain only. This never shows a restaurant, and never a date finer than
// the month, because the database will not return either (migration 0180).
// ============================================================================

export function FriendsInCities({ days = 90 }: { days?: number }) {
  const router = useRouter();
  const [groups, setGroups] = useState<FriendCityGroup[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setGroups(groupByFriend(await friendsCities(days)));
    } catch {
      // A side panel must never take the screen down with it.
      setFailed(true);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  if (failed) return null;
  if (groups === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.mute} />
      </View>
    );
  }
  if (groups.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Where your people are</Text>
      {groups.map((g) => (
        <Pressable
          key={g.friendId}
          style={styles.row}
          onPress={() => router.push(`/profile/${g.friendId}` as never)}
        >
          <Avatar uri={g.avatarUrl} name={g.displayName ?? g.username ?? "?"} size={38} />
          <View style={styles.body}>
            <Text style={styles.name} numberOfLines={1}>
              {g.displayName ?? g.username ?? "Someone"}
            </Text>
            <Text style={styles.cities} numberOfLines={2}>
              {g.cities
                .map((c) => `${cityLabel(c)} · ${whenLabel(c.lastMonth)}`)
                .join("   ")}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  loading: { paddingVertical: spacing.lg, alignItems: "center" },
  heading: { ...type.micro, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, gap: spacing.md },
  body: { flex: 1, minWidth: 0 },
  name: { ...type.body, color: colors.ink, fontWeight: "600" },
  cities: { ...type.small, color: colors.inkDim, marginTop: 2 },
});
