import { useEffect, useState } from "react";
import { View, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Text } from "../../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { OwnProfileConnections } from "../../components/OwnProfileConnections";
import { ProfileBody } from "../../components/ProfileBody";
import { useCaptureStatus, useCaptureFix } from "../../components/CaptureWarning";
import { supabase } from "../../lib/supabase";
import { colors, spacing, type } from "../../theme";
import { FONT_CAP } from "../../lib/a11y";

/** Owner-only navigation; the shared, privacy-gated profile body is unchanged. */
export default function MyProfileScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [section, setSection] = useState<"profile" | "connections">("profile");

  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data }) => setUserId(data.user?.id ?? null))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>YOUR PALATE</Text>
          <Text style={styles.title}>A taste of you.</Text>
        </View>
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
      {ready && userId && (
        <>
          <View style={styles.sections} accessibilityRole="tablist">
            {(["profile", "connections"] as const).map((item) => (
              <Pressable
                key={item}
                onPress={() => setSection(item)}
                accessibilityRole="tab"
                accessibilityState={{ selected: section === item }}
                style={[styles.sectionButton, section === item && styles.sectionSelected]}
              >
                <Text style={[styles.sectionText, section === item && styles.sectionTextSelected]}>
                  {item === "profile" ? "My profile" : "Connections"}
                </Text>
              </Pressable>
            ))}
          </View>
          {section === "profile" ? (
            <>
              <CaptureStatusRow />
              <ProfileBody targetId={userId} />
            </>
          ) : <OwnProfileConnections />}
        </>
      )}
      {ready && !userId && (
        <View style={styles.center}>
          <Text style={type.subtitle}>Sign in to see your profile.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

/** Shared opt-in/permission status, not a monitor-health claim. */
function CaptureStatusRow() {
  const status = useCaptureStatus();
  const fix = useCaptureFix("profile");
  if (!status) return null;
  const ok = status.kind === "ok";

  const content = (
    <>
      <View style={[styles.statusDot, { backgroundColor: status.kind === "unknown" ? colors.mute : ok ? colors.live : colors.red }]} />
      <View style={styles.statusCopy}>
        <Text style={styles.statusLabel} maxFontSizeMultiplier={FONT_CAP.chrome}>
          Passive capture
        </Text>
        <Text style={styles.statusBody}>{status.body}</Text>
      </View>
    </>
  );

  if (!("fix" in status)) {
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
      accessibilityLabel={`Passive capture settings. ${status.body} Review.`}
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
  heading: { flex: 1, paddingRight: spacing.md },
  eyebrow: { ...type.badge, letterSpacing: 1.8, color: colors.redText },
  title: { ...type.display, color: colors.ink, marginTop: 5 },
  sections: { flexDirection: "row", marginHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.sm, padding: 4, borderRadius: 16, backgroundColor: colors.wash },
  sectionButton: { flex: 1, minHeight: 44, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sectionSelected: { backgroundColor: colors.faint },
  sectionText: { ...type.small, color: colors.mute },
  sectionTextSelected: { color: colors.ink },
  gearBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.faint,
  },
  gearText: { fontSize: 18, color: colors.ink },
  center: { padding: 60, alignItems: "center" },
});
