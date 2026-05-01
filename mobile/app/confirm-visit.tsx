import { useState } from "react";
import { View, Text, StyleSheet, Alert, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spacer } from "../components/Button";
import { colors, spacing, type } from "../theme";
import { saveVisit, recordPromptDecision, rewardCopy } from "../lib/visits";
import { openInAppleMaps, openInGoogleMaps } from "../lib/maps";
import { FirstVisitCelebration } from "../components/FirstVisitCelebration";
import type { Restaurant } from "../lib/places";

export default function ConfirmVisit() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    place_id: string;
    name: string;
    address?: string;
    alternates?: string;
    confidence?: "high" | "medium" | "low";
  }>();

  const [showAlts, setShowAlts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [celebration, setCelebration] = useState<{ name: string } | null>(null);

  const alternates: Restaurant[] = params.alternates
    ? JSON.parse(params.alternates as string)
    : [];

  async function handleYes() {
    setBusy(true);
    try {
      const result = await saveVisit({ googlePlaceId: params.place_id as string, source: "auto" });
      await recordPromptDecision(params.place_id as string, "confirmed");
      if (result.isFirstVisit) {
        setCelebration({ name: params.name as string });
      } else {
        router.back();
        const r = rewardCopy(result.totalVisits);
        setTimeout(() => Alert.alert(r.title, r.message), 250);
      }
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message ?? "Try again");
    } finally {
      setBusy(false);
    }
  }

  async function handleNotNow() {
    await recordPromptDecision(params.place_id as string, "dismissed");
    router.back();
  }

  async function handleWrong() {
    await recordPromptDecision(params.place_id as string, "wrong_place");
    setShowAlts(true);
  }

  async function pickAlternate(p: Restaurant) {
    setBusy(true);
    try {
      const result = await saveVisit({ googlePlaceId: p.google_place_id, source: "auto" });
      await recordPromptDecision(p.google_place_id, "confirmed");
      if (result.isFirstVisit) {
        setCelebration({ name: p.name });
      } else {
        router.back();
        const r = rewardCopy(result.totalVisits);
        setTimeout(() => Alert.alert(r.title, r.message), 250);
      }
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message ?? "Try again");
    } finally {
      setBusy(false);
    }
  }

  if (showAlts) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.body}>
          <Text style={type.micro}>WRONG PLACE</Text>
          <Text style={styles.h1}>Pick the right one</Text>
          <Spacer />
          <FlatList
            data={alternates}
            keyExtractor={(it) => it.google_place_id}
            renderItem={({ item }) => (
              <Pressable onPress={() => pickAlternate(item)} style={styles.altRow}>
                <View style={{ flex: 1 }}>
                  <Text style={type.subtitle}>{item.name}</Text>
                  {item.address && <Text style={type.small}>{item.address}</Text>}
                </View>
                <Text style={styles.altPick}>Pick</Text>
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.line }} />}
            ListEmptyComponent={<Text style={[type.body, { color: colors.mute }]}>No other nearby spots found.</Text>}
          />
          <Spacer />
          <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={type.micro}>
          {params.confidence === "medium" ? "MIGHT BE NEARBY" : "WE THINK YOU'RE AT"}
        </Text>
        <Spacer size={6} />
        <Text style={styles.h1}>{params.name}</Text>
        {params.address && <Text style={[type.body, { color: colors.mute, marginTop: 6 }]}>{params.address}</Text>}

        <Spacer size={32} />
        <Text style={[type.body, { color: colors.ink }]}>
          {params.confidence === "medium"
            ? "Are you inside, or just nearby?"
            : "Are you eating here?"}
        </Text>
        <Spacer />
        <Button title={params.confidence === "medium" ? "Yes, I'm here" : "Yes, save it"} onPress={handleYes} loading={busy} />
        <Spacer />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable onPress={() => openInAppleMaps(params.name as string, params.address as string | undefined)} style={styles.mapsBtn}>
            <Text style={styles.mapsBtnText}>Apple Maps</Text>
          </Pressable>
          <Pressable onPress={() => openInGoogleMaps(params.name as string, params.address as string | undefined)} style={styles.mapsBtn}>
            <Text style={styles.mapsBtnText}>Google Maps</Text>
          </Pressable>
        </View>
        <Spacer />
        <Button title="Wrong restaurant" variant="ghost" onPress={handleWrong} />
        <Spacer />
        <Button title="Just nearby — not now" variant="ghost" onPress={handleNotNow} />
      </View>
      <FirstVisitCelebration
        visible={!!celebration}
        restaurantName={celebration?.name ?? ""}
        onDismiss={() => { setCelebration(null); router.back(); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  body: { flex: 1, padding: spacing.lg, paddingTop: spacing.xxl },
  h1: { ...type.display },
  altRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14 },
  altPick: { color: colors.red, fontWeight: "700" },
  mapsBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 14,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
    alignItems: "center",
  },
  mapsBtnText: { fontSize: 14, fontWeight: "700", color: colors.ink },
});
