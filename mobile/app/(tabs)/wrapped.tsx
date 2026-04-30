import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, Alert, ScrollView, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { generateForCurrentWeek, latestWrapped, type Wrapped } from "../../lib/wrapped";
import { WrappedCard } from "../../components/WrappedCard";
import ViewShot, { captureRef } from "react-native-view-shot";

export default function WrappedTab() {
  const [data, setData] = useState<Wrapped | null>(null);
  const [loading, setLoading] = useState(false);
  const cardRef = useRef<View>(null);

  const refresh = useCallback(async () => {
    try {
      const latest = await latestWrapped();
      setData(latest);
    } catch (e: any) {
      console.warn("wrapped load", e?.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function generate() {
    setLoading(true);
    try {
      const w = await generateForCurrentWeek();
      if (!w) {
        Alert.alert(
          "Nothing yet",
          "Add a visit or two this week and try again — we'll generate your Wrapped.",
        );
      } else {
        setData(w);
      }
    } catch (e: any) {
      Alert.alert("Couldn't generate", e.message ?? "Try again");
    } finally {
      setLoading(false);
    }
  }

  async function share() {
    if (!cardRef.current) return;
    try {
      const uri = await captureRef(cardRef, { format: "png", quality: 1 });
      await Share.share({ url: uri, message: "My Palate Wrapped" });
    } catch (e: any) {
      Alert.alert("Couldn't share", e.message ?? "Try again");
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={type.title}>Your Wrapped</Text>
        <Text style={[type.body, { color: colors.mute, marginTop: 4 }]}>
          A look at your real eating week.
        </Text>
        <Spacer size={20} />

        {data ? (
          <>
            <ViewShot ref={cardRef as any} options={{ format: "png", quality: 1 }}>
              <WrappedCard data={data} />
            </ViewShot>
            <Spacer />
            <Button title="Share" onPress={share} />
            <Spacer />
            <Button title="Refresh" variant="ghost" onPress={generate} loading={loading} />
          </>
        ) : (
          <View style={styles.empty}>
            <Text style={type.subtitle}>No Wrapped yet</Text>
            <Text style={[type.body, { color: colors.mute, marginTop: 6 }]}>
              Add a few visits, then tap below to generate this week's Wrapped.
            </Text>
            <Spacer />
            <Button title={loading ? "Generating…" : "Generate now"} onPress={generate} loading={loading} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { padding: spacing.lg, paddingBottom: 100 },
  empty: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
});
