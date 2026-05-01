import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, Image, ActivityIndicator,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { supabase } from "../lib/supabase";

// ============================================================================
// Photos — grid of every meal photo the user has attached. Tap to open
// the visit detail.
// ============================================================================

type PhotoRow = {
  id: string;
  visited_at: string;
  photo_url: string;
  restaurant_name: string | null;
};

const COLS = 3;
const SCREEN_W = Dimensions.get("window").width;
const TILE = (SCREEN_W - spacing.lg * 2 - 6) / COLS;

export default function PhotosScreen() {
  const router = useRouter();
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("visits")
        .select("id, visited_at, photo_url, restaurant:restaurants(name)")
        .not("photo_url", "is", null)
        .order("visited_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = (data ?? []).map((r: any) => ({
        id: r.id,
        visited_at: r.visited_at,
        photo_url: r.photo_url,
        restaurant_name: Array.isArray(r.restaurant) ? r.restaurant[0]?.name : r.restaurant?.name,
      })) as PhotoRow[];
      setPhotos(rows);
    } catch (e: any) {
      console.warn("photos load", e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Photos</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading && photos.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
      ) : photos.length === 0 ? (
        <View style={styles.center}>
          <Text style={type.subtitle}>No photos yet.</Text>
          <Text style={[type.small, { marginTop: 6, textAlign: "center", paddingHorizontal: 32 }]}>
            Tap any visit and add a photo of what you ate. Your meal grid grows here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          numColumns={COLS}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={{ gap: 3 }}
          ItemSeparatorComponent={() => <View style={{ height: 3 }} />}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/visit/${item.id}`)}>
              <Image
                source={{ uri: item.photo_url }}
                style={{ width: TILE, height: TILE, borderRadius: 6, backgroundColor: colors.faint }}
              />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomColor: colors.line, borderBottomWidth: 1,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.faint,
  },
  closeText: { fontSize: 18, fontWeight: "700", color: colors.ink },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  grid: { padding: spacing.lg },
});
