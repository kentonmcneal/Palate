import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { listWishlist, removeFromWishlist, type WishlistEntry } from "../../lib/palate-insights";
import { saveVisit } from "../../lib/visits";

export default function WishlistTab() {
  const router = useRouter();
  const [entries, setEntries] = useState<WishlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const e = await listWishlist();
      setEntries(e);
    } catch (e: any) {
      console.warn("wishlist load", e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  function handleRemove(entry: WishlistEntry) {
    Alert.alert("Remove from wishlist?", entry.restaurant?.name ?? "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await removeFromWishlist(entry.id);
            setEntries((curr) => curr.filter((e) => e.id !== entry.id));
          } catch (e: any) {
            Alert.alert("Couldn't remove", e.message ?? "Try again");
          }
        },
      },
    ]);
  }

  async function handleLogVisit(entry: WishlistEntry) {
    if (!entry.restaurant) return;
    try {
      await saveVisit({
        googlePlaceId: entry.restaurant.google_place_id,
        source: "manual",
      });
      // Remove from wishlist after successful visit log — they've been now
      await removeFromWishlist(entry.id);
      setEntries((curr) => curr.filter((e) => e.id !== entry.id));
      Alert.alert("Logged", `${entry.restaurant.name} saved as today's visit.`);
    } catch (e: any) {
      Alert.alert("Couldn't log visit", e.message ?? "Try again");
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <Text style={type.title}>Wishlist</Text>
        <Text style={[type.body, { color: colors.mute, marginTop: 4 }]}>
          Spots you've saved from your weekly Palate insights.
        </Text>
        <Spacer size={20} />

        {loading && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.red} />
          </View>
        )}

        {!loading && entries.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={type.subtitle}>Nothing saved yet.</Text>
            <Text style={[type.small, { marginTop: 6, lineHeight: 20 }]}>
              When your weekly Wrapped suggests places to try, tap{" "}
              <Text style={{ fontWeight: "700", color: colors.red }}>Save</Text> on any of
              them — they'll show up here.
            </Text>
          </View>
        )}

        {!loading && entries.map((entry) => (
          <WishlistRow
            key={entry.id}
            entry={entry}
            onLog={() => handleLogVisit(entry)}
            onRemove={() => handleRemove(entry)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function WishlistRow({
  entry,
  onLog,
  onRemove,
}: {
  entry: WishlistEntry;
  onLog: () => void;
  onRemove: () => void;
}) {
  const r = entry.restaurant;
  if (!r) return null;
  const subline = [
    r.cuisine_type ? capitalize(r.cuisine_type) : null,
    r.neighborhood,
  ].filter(Boolean).join(" · ");
  const added = new Date(entry.added_at);

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName}>{r.name}</Text>
          <Text style={styles.cardSub}>{subline || "Nearby"}</Text>
          <Text style={styles.cardDate}>
            Saved {added.toLocaleDateString([], { month: "short", day: "numeric" })}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable onPress={onLog} style={styles.btnPrimary}>
          <Text style={styles.btnPrimaryText}>I went here</Text>
        </Pressable>
        <Pressable onPress={onRemove} style={styles.btnGhost}>
          <Text style={styles.btnGhostText}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { padding: spacing.lg, paddingBottom: 100 },
  center: { padding: 40, alignItems: "center" },
  emptyCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.paper,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    marginBottom: 10,
  },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardName: { ...type.subtitle },
  cardSub: { ...type.small, marginTop: 2 },
  cardDate: { ...type.small, marginTop: 4, color: colors.mute },
  actions: { marginTop: 12, flexDirection: "row", gap: 10 },
  btnPrimary: {
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimaryText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  btnGhost: {
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.faint,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhostText: { color: colors.mute, fontSize: 13, fontWeight: "700" },
});
