import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Button, Spacer } from "../components/Button";
import { GmailImportCard } from "../components/GmailImportCard";
import { colors, spacing, type } from "../theme";

/**
 * Bringing in the history you already have.
 *
 * One screen, used two ways. During onboarding it takes a `next` param and
 * shows a skip; from the Home activation prompt or Settings it is an ordinary
 * pushed screen with a back button.
 *
 * It exists because the activation prompt used to route to /settings, where the
 * Gmail card is one collapsed section among a dozen — "Scan my email" landed
 * you on a wall of closed accordions with nothing obviously to do. A call to
 * action has to arrive somewhere that is about the action.
 */
export default function ImportEmail() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const onboarding = typeof next === "string" && next.length > 0;

  function done() {
    if (onboarding) router.replace(next as never);
    else router.back();
  }

  return (
    <SafeAreaView style={styles.safe}>
      {!onboarding && (
        <View style={styles.nav}>
          <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button">
            <Text style={styles.backText}>←</Text>
          </Pressable>
          <Text style={type.title}>Your history</Text>
          <View style={{ width: 40 }} />
        </View>
      )}

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.h1}>
          {onboarding ? "Start with meals\nyou've already had." : "Bring in your history"}
        </Text>
        <Spacer size={10} />
        <Text style={styles.p}>
          Reservation and delivery confirmations already sitting in your inbox
          become visits — so Palate knows your taste before you log anything.
        </Text>

        <Spacer size={24} />
        <GmailImportCard />

        <Spacer size={24} />
        <View style={styles.card}>
          <Text style={styles.cardTitle}>What we read, and what we don't</Text>
          <Text style={styles.cardBody}>
            Read-only, and only messages from restaurant platforms — OpenTable,
            Resy, Toast, Square, DoorDash and a dozen more. We look for the
            restaurant and the date. Nothing else is read, nothing is stored
            except the visit, and you see everything before it is saved.
          </Text>
          <Spacer size={10} />
          <Text style={styles.cardBody}>
            Disconnect any time in Settings, and the access is revoked.
          </Text>
        </View>
      </ScrollView>

      {onboarding && (
        <View style={styles.cta}>
          <Button title="Continue" onPress={done} />
          <Spacer size={8} />
          <Pressable onPress={done} style={styles.skip} accessibilityRole="button">
            <Text style={styles.skipText}>Skip — I'll do this later</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  nav: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.line, borderBottomWidth: 1,
  },
  back: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center",
    justifyContent: "center", backgroundColor: colors.faint,
  },
  backText: { fontSize: 18, fontWeight: "700", color: colors.ink },
  body: { padding: spacing.lg, paddingBottom: 60 },
  h1: { ...type.display, fontSize: 30, lineHeight: 35, color: colors.ink },
  p: { ...type.body, color: colors.mute, lineHeight: 23 },
  card: {
    padding: spacing.lg, borderRadius: 20,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  cardTitle: { fontSize: 15, fontWeight: "800", color: colors.ink, marginBottom: 8 },
  cardBody: { ...type.small, lineHeight: 20 },
  cta: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.line },
  skip: { paddingVertical: 12, alignItems: "center" },
  skipText: { fontSize: 14, fontWeight: "700", color: colors.mute },
});
