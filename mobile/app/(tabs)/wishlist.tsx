import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { listWishlist, removeFromWishlist, type WishlistEntry } from "../../lib/palate-insights";
import { saveVisit, rewardCopy } from "../../lib/visits";

type GroupBy = "recent" | "cuisine" | "neighborhood";

export default function WishlistTab() {
  const router = useRouter();
  const [entries, setEntries] = useState<WishlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("recent");

  const grouped = useMemo(() => groupEntries(entries, groupBy), [entries, groupBy]);

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
      const result = await saveVisit({
        googlePlaceId: entry.restaurant.google_place_id,
        source: "manual",
      });
      // Remove from wishlist after successful visit log — they've been now
      await removeFromWishlist(entry.id);
      setEntries((curr) => curr.filter((e) => e.id !== entry.id));
      const r = rewardCopy(result.totalVisits);
      Alert.alert(r.title, r.message);
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
        <Text style={type.title}>Try List</Text>
        <Text style={[type.body, { color: colors.mute, marginTop: 4 }]}>
          Spots you've saved from your weekly Palate insights.
        </Text>

        {entries.length > 0 && (
          <>
            <Spacer size={16} />
            <View style={styles.segmented}>
              {(["recent", "cuisine", "neighborhood"] as GroupBy[]).map((g) => (
                <Pressable
                  key={g}
                  onPress={() => setGroupBy(g)}
                  style={[styles.segment, groupBy === g && styles.segmentActive]}
                >
                  <Text style={[styles.segmentText, groupBy === g && styles.segmentTextActive]}>
                    {g === "recent" ? "Recent" : g === "cuisine" ? "By cuisine" : "By area"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
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

        {!loading && grouped.map(({ heading, items }) => (
          <View key={heading} style={{ marginBottom: spacing.lg }}>
            {groupBy !== "recent" && (
              <Text style={styles.groupHeading}>{heading}</Text>
            )}
            {items.map((entry) => (
              <WishlistRow
                key={entry.id}
                entry={entry}
                onLog={() => handleLogVisit(entry)}
                onRemove={() => handleRemove(entry)}
              />
            ))}
          </View>
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
        <Pressable onPress={() => openInMaps(r.name, r.neighborhood)} style={styles.btnGhost}>
          <Text style={styles.btnGhostText}>Maps</Text>
        </Pressable>
        <Pressable onPress={onRemove} style={styles.btnGhost}>
          <Text style={styles.btnGhostText}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}

function openInMaps(name: string, neighborhood: string | null) {
  const query = encodeURIComponent(neighborhood ? `${name}, ${neighborhood}` : name);
  const url = Platform.OS === "ios"
    ? `maps://?q=${query}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
  Linking.openURL(url).catch(() => {
    Alert.alert("Couldn't open Maps", "Try searching for it directly in Maps.");
  });
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
}

function groupEntries(
  entries: WishlistEntry[],
  by: GroupBy,
): Array<{ heading: string; items: WishlistEntry[] }> {
  if (by === "recent") return [{ heading: "Recent", items: entries }];

  const map = new Map<string, WishlistEntry[]>();
  for (const e of entries) {
    const key =
      by === "cuisine"
        ? capitalize(e.restaurant?.cuisine_type ?? "Other")
        : (e.restaurant?.neighborhood ?? "Nearby");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  // Largest groups first; "Other" / "Nearby" goes to the bottom.
  return [...map.entries()]
    .sort((a, b) => {
      const aDefault = a[0] === "Other" || a[0] === "Nearby";
      const bDefault = b[0] === "Other" || b[0] === "Nearby";
      if (aDefault !== bDefault) return aDefault ? 1 : -1;
      return b[1].length - a[1].length;
    })
    .map(([heading, items]) => ({ heading, items }));
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
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.faint,
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
  },
  segmentActive: { backgroundColor: colors.paper, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  segmentText: { fontSize: 13, fontWeight: "600", color: colors.mute },
  segmentTextActive: { color: colors.ink },
  groupHeading: {
    ...type.micro,
    marginBottom: 8,
    marginTop: 4,
    color: colors.mute,
  },
});
