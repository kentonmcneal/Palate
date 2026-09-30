import { View, ScrollView, StyleSheet } from "react-native";
import { Text } from "../../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { track } from "../../lib/analytics";

export default function PrivacyScreen() {
  const router = useRouter();
  function finish() {
    void track("onboarding_finished");
    router.replace("/(tabs)");
  }
  return (
    <SafeAreaView style={styles.safe}>
      {/* Scrolls. A plain View does not, so at any larger Dynamic Type setting
          the copy simply drew over the buttons below it. Same fix, and same
          reason, as passive-capture-intro. The CTA stays OUTSIDE the scroller
          so it is reachable no matter how tall the copy gets. */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.h1}>Your data, your call.</Text>
        <Spacer />
        <Text style={styles.p}>
          Review your profile and visit visibility settings before sharing.
          Suggested places and detection details may sync to your account before
          you confirm a diary visit. Location does not tell Palate what you ordered.
          We don't sell your data and we don't show ads.
        </Text>
        <Spacer size={32} />
        <Row title="Pause anytime" body="Manage foreground checks and background suggestions separately in Settings." />
        <Row title="Delete what you want" body="Delete individual visits or use Settings to delete all visit history or your account." />
        <Row title="Place lookups" body="Palate may send location to its servers and a places provider to find nearby places." />
      </ScrollView>
      <View style={styles.cta}>
        <Button title="Let's eat" onPress={finish} />
      </View>
    </SafeAreaView>
  );
}

function Row({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ marginTop: spacing.lg }}>
      <Text style={styles.rowTitle}>{title}</Text>
      <Text style={styles.rowBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { flexGrow: 1, padding: spacing.lg, paddingTop: spacing.xxl },
  cta: { padding: spacing.lg },
  h1: { ...type.display, color: colors.ink },
  p: { ...type.body, color: colors.mute, lineHeight: 24 },
  rowTitle: { ...type.subtitle, color: colors.ink },
  rowBody: { ...type.body, color: colors.mute, marginTop: 4 },
});
