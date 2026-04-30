import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";

export default function WhyLocation() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={styles.h1}>Why location?</Text>
        <Spacer />
        <Bullet emoji="📍" text="Palate uses your location only to detect nearby restaurants when the app is open." />
        <Bullet emoji="🙋" text="We always ask before we save a visit. You can say no, or pick the right place." />
        <Bullet emoji="🔕" text="Pause tracking anytime in Settings — your past visits stay, nothing new is recorded." />
        <Bullet emoji="🗑️" text="Delete a single visit, your whole history, or your entire account whenever you want." />
      </View>
      <View style={styles.cta}>
        <Button title="Continue" onPress={() => router.push("/onboarding/permission")} />
      </View>
    </SafeAreaView>
  );
}

function Bullet({ emoji, text }: { emoji: string; text: string }) {
  return (
    <View style={styles.bullet}>
      <Text style={{ fontSize: 22 }}>{emoji}</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper, justifyContent: "space-between" },
  body: { padding: spacing.lg, paddingTop: spacing.xxl },
  cta: { padding: spacing.lg },
  h1: { ...type.display, color: colors.ink },
  bullet: { flexDirection: "row", gap: 14, alignItems: "flex-start", marginTop: spacing.lg },
  bulletText: { ...type.body, color: colors.ink, flex: 1, lineHeight: 22 },
});
