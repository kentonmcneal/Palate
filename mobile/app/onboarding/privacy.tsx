import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";

export default function PrivacyScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={styles.h1}>Your data, your call.</Text>
        <Spacer />
        <Text style={styles.p}>
          You decide what's public. Profile visibility, your friends list, what
          shows up in any feed — all your call. We don't sell your data and we
          don't show ads.
        </Text>
        <Spacer size={32} />
        <Row title="Pause anytime" body="Toggle off location tracking from Settings." />
        <Row title="Delete what you want" body="Single visits, a week, or everything." />
        <Row title="No selling, ever" body="Restaurants don't see your name or email." />
      </View>
      <View style={styles.cta}>
        <Button title="Let's eat" onPress={() => router.replace("/(tabs)")} />
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
  safe: { flex: 1, backgroundColor: colors.paper, justifyContent: "space-between" },
  body: { padding: spacing.lg, paddingTop: spacing.xxl },
  cta: { padding: spacing.lg },
  h1: { ...type.display, color: colors.ink },
  p: { ...type.body, color: colors.mute, lineHeight: 24 },
  rowTitle: { ...type.subtitle, color: colors.ink },
  rowBody: { ...type.body, color: colors.mute, marginTop: 4 },
});
