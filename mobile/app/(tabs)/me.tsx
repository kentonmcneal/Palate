import { useEffect, useState } from "react";
import { View, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Text } from "../../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ProfileBody } from "../../components/ProfileBody";
import { useCaptureStatus, useCaptureFix } from "../../components/CaptureWarning";
import { supabase } from "../../lib/supabase";
import { colors, spacing, type } from "../../theme";
import { FONT_CAP } from "../../lib/a11y";

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
      {ready && userId && <CaptureStatusRow />}
      {ready && userId && <ProfileBody targetId={userId} />}
      {ready && !userId && (
        <View style={styles.center}>
          <Text style={type.subtitle}>Sign in to see your profile.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

/**
 * Whether passive capture is actually working, as a status light under the
 * Profile header. The strip in the tab layout carries the same message while
 * something is off; this row is the place that also says so when everything
 * is ON, so a person can confirm the feature is running instead of wondering.
 * Same decision, same words, same fix as the strip (components/CaptureWarning).
 */
function CaptureStatusRow() {
  const status = useCaptureStatus();
  const fix = useCaptureFix("profile");
  if (!status) return null;
  const ok = status.kind === "ok";

  const content = (
    <>
      <View style={[styles.statusDot, { backgroundColor: ok ? colors.live : colors.red }]} />
      <View style={styles.statusCopy}>
        <Text style={styles.statusLabel} maxFontSizeMultiplier={FONT_CAP.chrome}>
          Passive capture
        </Text>
        <Text style={styles.statusBody}>{status.body}</Text>
      </View>
    </>
  );

  if (ok) {
    return (
      <View style={styles.statusRow} accessible accessibilityLabel={`Passive capture. ${status.body}`}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => fix(status)}
      style={({ pressed }) => [styles.statusRow, pressed && styles.statusRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Passive capture is off. ${status.body} Fix.`}
    >
      {content}
      <Text style={styles.statusFix} maxFontSizeMultiplier={FONT_CAP.chrome}>Fix</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  statusRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
  },
  statusRowPressed: { opacity: 0.7 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusCopy: { flex: 1 },
  statusLabel: { fontSize: 13, lineHeight: 18, fontWeight: "800", color: colors.ink },
  statusBody: { ...type.small, lineHeight: 18 },
  // Small red text on a light ground uses the darker red, which is the one
  // that clears WCAG AA.
  statusFix: { fontSize: 13, fontWeight: "800", color: colors.redText },
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
