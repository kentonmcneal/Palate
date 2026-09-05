import { useState } from "react";
import { View, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { isApproved } from "../lib/waitlist";
import { signOut } from "../lib/auth";

export default function WaitlistScreen() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [stillPending, setStillPending] = useState(false);

  async function checkAgain() {
    setChecking(true);
    setStillPending(false);
    try {
      if (await isApproved()) {
        router.replace("/(tabs)");
      } else {
        setStillPending(true);
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={styles.emoji}>✨</Text>
        <Text style={styles.title}>You're on the list</Text>
        <Text style={styles.copy}>
          Palate is invite-only right now — we're letting people in a few at a
          time. You'll get access soon. Thanks for your patience.
        </Text>

        <Pressable onPress={checkAgain} disabled={checking} style={styles.primary}>
          {checking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>Check my status</Text>
          )}
        </Pressable>
        {stillPending && (
          <Text style={styles.pending}>
            Not approved yet — hang tight, we'll let you in soon.
          </Text>
        )}

        <Pressable
          onPress={async () => {
            await signOut();
            router.replace("/sign-in");
          }}
          hitSlop={8}
          style={{ marginTop: 28 }}
        >
          <Text style={styles.signout}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  emoji: { fontSize: 44, marginBottom: 12 },
  title: {
    fontFamily: type.display.fontFamily,
    fontSize: 32,
    color: colors.ink,
    letterSpacing: -0.6,
    textAlign: "center",
  },
  copy: {
    ...type.body,
    color: colors.mute,
    textAlign: "center",
    lineHeight: 24,
    marginTop: 14,
    maxWidth: 320,
  },
  primary: {
    marginTop: 28,
    paddingVertical: 15,
    paddingHorizontal: 28,
    borderRadius: 999,
    backgroundColor: colors.red,
    minWidth: 200,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  pending: { ...type.small, color: colors.mute, marginTop: 14, textAlign: "center" },
  signout: { ...type.small, color: colors.mute, fontWeight: "700" },
});
