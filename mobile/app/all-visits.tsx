import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, Image, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Spacer } from "../components/Button";
import { colors, spacing, type } from "../theme";
import { recentVisits, type Visit } from "../lib/visits";

const PAGE_SIZE = 50;

export default function AllVisitsScreen() {
  const router = useRouter();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      // recentVisits returns up to N from newest. Pull a big page (server caps).
      const all = await recentVisits(500);
      setVisits(all);
    } catch (e: any) {
      console.warn("all-visits load", e?.message);
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
        <Text style={type.title}>All visits</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading && visits.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
      ) : visits.length === 0 ? (
        <View style={styles.center}>
          <Text style={type.subtitle}>No visits yet.</Text>
          <Text style={[type.small, { marginTop: 6 }]}>Log your first one and they'll show up here.</Text>
        </View>
      ) : (
        <FlatList
          data={visits}
          keyExtractor={(v) => v.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
          ItemSeparatorComponent={() => <Spacer size={10} />}
          renderItem={({ item }) => (
            <VisitCard visit={item} onPress={() => router.push(`/visit/${item.id}` as any)} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function VisitCard({ visit, onPress }: { visit: Visit; onPress: () => void }) {
  const r = visit.restaurant;
  const dt = new Date(visit.visited_at);
  return (
    <Pressable onPress={onPress} style={styles.card}>
      {visit.photo_url ? (
        <Image source={{ uri: visit.photo_url }} style={styles.thumb} />
      ) : (
        <View style={styles.thumbEmpty}><Text style={styles.thumbEmptyEmoji}>·</Text></View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{r?.name ?? "Unknown"}</Text>
        <Text style={[type.small, { marginTop: 2 }]}>
          {dt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
          {" · "}{dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </Text>
        {r?.cuisine_type && (
          <Text style={[type.small, { marginTop: 2, color: colors.mute }]}>
            {r.cuisine_type[0].toUpperCase() + r.cuisine_type.slice(1).replace(/_/g, " ")}
            {r.neighborhood ? ` · ${r.neighborhood}` : ""}
          </Text>
        )}
      </View>
    </Pressable>
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
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: spacing.md, borderRadius: 16,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.line,
  },
  thumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: colors.faint },
  thumbEmpty: {
    width: 56, height: 56, borderRadius: 12,
    backgroundColor: colors.faint, alignItems: "center", justifyContent: "center",
  },
  thumbEmptyEmoji: { fontSize: 24, color: colors.mute },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
});
