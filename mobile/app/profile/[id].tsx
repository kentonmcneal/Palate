import { View, StyleSheet, Pressable } from "react-native";
import { Text } from "../../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ProfileBody } from "../../components/ProfileBody";
import { colors, spacing, type } from "../../theme";

/**
 * Somebody else's profile — and, if you navigate here with your own id, yours.
 * The screen is a header plus `ProfileBody`; every rule about what is visible
 * lives in the snapshot RPC, and every rendering decision lives in the shared
 * body. This file decides one thing: there is a back button.
 */
export default function FriendProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Profile</Text>
        <View style={{ width: 40 }} />
      </View>
      <ProfileBody targetId={id as string} />
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
});
