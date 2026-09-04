import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ProfileBody } from "../../components/ProfileBody";
import { supabase } from "../../lib/supabase";
import { colors, spacing, type } from "../../theme";

/**
 * The Profile tab.
 *
 * This tab used to point at the Settings screen with the word "Profile" on it,
 * which is why nobody had a profile: the app had no place where you could see
 * yourself the way other people see you. It now renders the same body as
 * `profile/[id]`, so what you look at IS what a friend looks at — the numbers
 * match, the sections match, and anything hidden from them is hidden from this
 * view too, with the private remainder disclosed rather than silently dropped.
 *
 * Settings moved out to its own pushed route behind the gear.
 */
export default function MyProfileScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data }) => setUserId(data.user?.id ?? null))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={{ width: 40 }} />
        <Text style={type.title}>Profile</Text>
        <Pressable
          onPress={() => router.push("/settings" as never)}
          style={styles.gearBtn}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <Text style={styles.gearText}>⚙</Text>
        </Pressable>
      </View>

      {!ready && (
        <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
      )}
      {ready && userId && <ProfileBody targetId={userId} />}
      {ready && !userId && (
        <View style={styles.center}>
          <Text style={type.subtitle}>Sign in to see your profile.</Text>
        </View>
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
  gearBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.faint,
  },
  gearText: { fontSize: 18, color: colors.ink },
  center: { padding: 60, alignItems: "center" },
});
