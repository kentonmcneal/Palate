import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Logo } from "../../components/Logo";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";

export default function Welcome() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Logo size={64} />
        <Spacer size={32} />
        <Text style={styles.h1}>See what you actually eat.</Text>
        <Spacer />
        <Text style={styles.p}>
          Your eating habits have a pattern. Palate tells you what it means.
        </Text>
        <Spacer size={12} />
        <Text style={[styles.p, { fontStyle: "italic", color: colors.mute }]}>
          Not what you say you like. What your behavior proves.
        </Text>
      </View>
      <View style={styles.cta}>
        <Button title="Get started" onPress={() => router.push("/onboarding/profile-setup")} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper, justifyContent: "space-between" },
  body: { padding: spacing.lg, paddingTop: spacing.xxl },
  cta: { padding: spacing.lg },
  h1: { ...type.display, color: colors.ink },
  p: { ...type.body, color: colors.mute, lineHeight: 24 },
});
