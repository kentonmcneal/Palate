import { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Logo, LOGO_SIZE } from "../../components/Logo";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { track } from "../../lib/analytics";

export default function Welcome() {
  const router = useRouter();
  useEffect(() => { void track("onboarding_started"); }, []);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Logo size={LOGO_SIZE.hero} />
        <Spacer size={32} />
        <Text style={styles.h1}>Start to see how you actually eat.</Text>
        <Spacer />
        <Text style={styles.p}>
          Your eating habits have a pattern. Palate helps you notice it.
        </Text>
        <Spacer size={12} />
        <Text style={[styles.p, { fontStyle: "italic", color: colors.mute }]}>
          Not what you say you like. What your habits start to reveal.
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
