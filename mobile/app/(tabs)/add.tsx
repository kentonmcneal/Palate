import { useState } from "react";
import { View, Text, StyleSheet, TextInput, FlatList, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { searchRestaurants, type Restaurant } from "../../lib/places";
import { saveVisit } from "../../lib/visits";
import { getCurrentLocation } from "../../lib/location";
import { FirstVisitCelebration } from "../../components/FirstVisitCelebration";

export default function AddTab() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(false);
  const [celebration, setCelebration] = useState<{ name: string } | null>(null);

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    try {
      let near: { lat: number; lng: number } | undefined;
      try {
        const loc = await getCurrentLocation();
        near = { lat: loc.lat, lng: loc.lng };
      } catch {
        // location not granted — search without bias
      }
      const r = await searchRestaurants(query.trim(), near);
      setResults(r);
    } catch (e: any) {
      Alert.alert("Search failed", e.message ?? "Try again");
    } finally {
      setLoading(false);
    }
  }

  async function pickPlace(p: Restaurant) {
    try {
      const result = await saveVisit({ googlePlaceId: p.google_place_id, source: "manual" });
      if (result.isFirstVisit) {
        setCelebration({ name: p.name });
      } else {
        Alert.alert("Saved", `${p.name} added.`, [
          { text: "OK", onPress: () => router.replace("/(tabs)") },
        ]);
      }
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message ?? "Try again");
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={type.title}>Add a visit</Text>
        <Text style={[type.body, { color: colors.mute, marginTop: 4 }]}>
          Search for a place. We'll save it as today's visit.
        </Text>
        <Spacer size={20} />
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search restaurants, cafés…"
            placeholderTextColor={colors.mute}
            style={styles.input}
            returnKeyType="search"
            onSubmitEditing={handleSearch}
            autoCapitalize="words"
          />
        </View>
        <Spacer />
        <Button title={loading ? "Searching…" : "Search"} onPress={handleSearch} loading={loading} />
        <Spacer size={20} />
        <FlatList
          data={results}
          keyExtractor={(item) => item.google_place_id}
          renderItem={({ item }) => (
            <Pressable onPress={() => pickPlace(item)} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                {item.address && <Text style={type.small}>{item.address}</Text>}
              </View>
              <Text style={styles.add}>+</Text>
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.line }} />}
        />
      </View>
      <FirstVisitCelebration
        visible={!!celebration}
        restaurantName={celebration?.name ?? ""}
        onDismiss={() => { setCelebration(null); router.replace("/(tabs)"); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, padding: spacing.lg },
  searchRow: { flexDirection: "row" },
  input: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    fontSize: 16,
    color: colors.ink,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
  },
  name: { ...type.subtitle },
  add: { fontSize: 28, color: colors.red, fontWeight: "700", marginLeft: 12 },
});
