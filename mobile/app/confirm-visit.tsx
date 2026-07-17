import { useMemo, useState } from "react";
import { View, Text, StyleSheet, Alert, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spacer } from "../components/Button";
import { colors, spacing, type } from "../theme";
import { saveVisit, recordPromptDecision, rewardCopy } from "../lib/visits";
import { openInAppleMaps, openInGoogleMaps } from "../lib/maps";
import { FirstVisitCelebration } from "../components/FirstVisitCelebration";
import { VisitCelebration } from "../components/VisitCelebration";
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
  const [burst, setBurst] = useState(0);
  const [celebration, setCelebration] = useState<{
    name: string;
    restaurantId: string;
    visitId: string;
  } | null>(null);

  // Guard the parse: a malformed `alternates` param would otherwise throw
  // during render and white-screen the app (not a catchable handler). Memoized
  // so it doesn't re-parse on every render.
  const alternates: Restaurant[] = useMemo(() => {
    try {
      return params.alternates ? JSON.parse(params.alternates as string) : [];
    } catch {
      return [];
    }
  }, [params.alternates]);

  async function handleYes() {
    setBusy(true);
    try {
      const result = await saveVisit({ googlePlaceId: params.place_id as string, source: "auto" });
      await recordPromptDecision(params.place_id as string, "confirmed");
      if (result.isFirstVisit) {
        setCelebration({
          name: params.name as string,
          restaurantId: result.restaurant_id,
          visitId: result.id,
        });
      } else {
        // Light celebration before we hand off to rate-items.
        setBurst((k) => k + 1);
        setTimeout(() => {
          router.replace({
            pathname: "/rate-items",
            params: {
              restaurant_id: result.restaurant_id,
              visit_id: result.id,
              name: params.name as string,
            },
          });
        }, 1100);
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

  async function handleSkipToday() {
    await recordPromptDecision(params.place_id as string, "skip_today");
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
        setCelebration({
          name: p.name,
          restaurantId: result.restaurant_id,
          visitId: result.id,
        });
      } else {
        setBurst((k) => k + 1);
        setTimeout(() => {
          router.replace({
            pathname: "/rate-items",
            params: {
              restaurant_id: result.restaurant_id,
              visit_id: result.id,
              name: p.name,
            },
          });
        }, 1100);
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
            ? `Are you inside ${params.name}, or just nearby?`
            : `Are you eating at ${params.name}?`}
        </Text>
        <Spacer />
        <Button title={params.confidence === "medium" ? "Yes, log visit" : "Yes, log visit"} onPress={handleYes} loading={busy} />
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
        <Button title="Not here" variant="ghost" onPress={handleNotNow} />
        <Spacer />
        <Button title="Wrong restaurant" variant="ghost" onPress={handleWrong} />
        <Spacer />
        <Button title="Don't ask again today for this place" variant="ghost" onPress={handleSkipToday} />
      </View>
      <FirstVisitCelebration
        visible={!!celebration}
        restaurantName={celebration?.name ?? ""}
        onDismiss={() => {
          const c = celebration;
          setCelebration(null);
          if (c) {
            router.replace({
              pathname: "/rate-items",
              params: { restaurant_id: c.restaurantId, visit_id: c.visitId, name: c.name },
            });
          } else {
            router.back();
          }
        }}
      />
      <VisitCelebration fire={burst} />
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
