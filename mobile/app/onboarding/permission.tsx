import { useState } from "react";
import { View, Text, StyleSheet, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { requestForegroundPermission } from "../../lib/location";

export default function Permission() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleAllow() {
    setLoading(true);
    try {
      const { granted, status } = await requestForegroundPermission();
      if (granted) {
        router.push("/onboarding/privacy");
      } else if (status === "denied") {
        Alert.alert(
          "Location is off",
          "You can still use Palate by adding visits manually. To turn location on, open Settings → Palate → Location.",
          [
            { text: "Open Settings", onPress: () => Linking.openSettings() },
            { text: "Continue without", onPress: () => router.push("/onboarding/privacy") },
          ],
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={styles.h1}>Allow location</Text>
        <Spacer />
        <Text style={styles.p}>
          When you tap "Allow," iOS will ask if Palate can use your location. Choose
          "While Using the App."
        </Text>
        <Spacer size={32} />
        <View style={styles.card}>
          <Text style={styles.cardTitle}>What we'll do with it</Text>
          <Text style={styles.cardBody}>
            When you ask Palate to check, we look up nearby restaurants and ask you
            which one you're at — if any. We never sell your location.
          </Text>
        </View>
      </View>
      <View style={styles.cta}>
        <Button title="Allow location" onPress={handleAllow} loading={loading} />
        <Spacer />
        <Button
          title="Skip for now"
          variant="ghost"
          onPress={() => router.push("/onboarding/privacy")}
        />
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
  card: {
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 18,
    padding: spacing.lg,
    backgroundColor: colors.faint,
  },
  cardTitle: { ...type.subtitle, color: colors.ink },
  cardBody: { ...type.body, color: colors.mute, marginTop: 6, lineHeight: 22 },
});
