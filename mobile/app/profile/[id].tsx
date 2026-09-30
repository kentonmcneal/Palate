import { View, StyleSheet, Pressable } from "react-native";
import { Text } from "../../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ProfileBody } from "../../components/ProfileBody";
import { colors, spacing, type } from "../../theme";
import { profileIdFromRoute } from "../../lib/profile-route";

/**
 * Somebody else's profile — and, if you navigate here with your own id, yours.
 * The screen is a header plus `ProfileBody`; every rule about what is visible
 * lives in the snapshot RPC, and every rendering decision lives in the shared
 * body. This file decides one thing: there is a back button.
 */
export default function FriendProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  // Validated, not cast. `id as string` asserted a shape nobody had checked:
  // three of the four notification deep-links push `/profile/${user_id ?? ""}`,
  // so a payload without user_id arrived here empty and was handed to
  // get_friend_profile_snapshot — which rejects the invalid uuid and reports an
  // error against the one RPC this project watches. See lib/profile-route.ts.
  const targetId = profileIdFromRoute(params.id);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.closeBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          {/* An arrow glyph reads as "left arrow" or nothing at all to a screen
              reader, so the label above carries the meaning. */}
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Profile</Text>
        <View style={{ width: 40 }} />
      </View>
      {targetId === null ? (
        // Says what happened instead of rendering a profile-shaped error. The
        // back button above still works, which is the only way out of a modal.
        <View style={styles.unavailable}>
          <Text style={styles.unavailableTitle}>Profile unavailable</Text>
          <Text style={styles.unavailableBody}>
            This link didn't include a person to open. Try finding them from your
            feed or from Search.
          </Text>
        </View>
      ) : (
        <ProfileBody targetId={targetId} />
      )}
    </SafeAreaView>
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
  unavailable: { padding: spacing.lg, paddingTop: spacing.xxl, gap: spacing.sm },
  unavailableTitle: { ...type.subtitle, color: colors.ink },
  unavailableBody: { ...type.body, color: colors.mute, lineHeight: 22 },
});
