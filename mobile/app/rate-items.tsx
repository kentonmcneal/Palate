import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spacer } from "../components/Button";
import { colors, spacing, type } from "../theme";
import {
  listForRestaurant, addAndRate, rateItem,
  type MenuItem, type ItemRating,
} from "../lib/menu-items";
import { triggerHapticSelection, triggerHapticSuccess } from "../lib/haptics";

// ============================================================================
// Rate Items — the "What did you get?" sheet that follows a logged visit.
// ----------------------------------------------------------------------------
// Lightweight, tap-based. Three reactions per item: Loved / OK / Not for me.
// User can tap an existing item from the catalog or type a new one.
// Skip is always one tap away — we don't block the flow.
// ============================================================================

const RATINGS: { key: ItemRating; label: string; emoji: string; color: string }[] = [
  { key: "loved",        label: "Loved",       emoji: "♥", color: colors.red },
  { key: "ok",           label: "It was OK",   emoji: "·", color: colors.mute },
  { key: "not_for_me",   label: "Not for me",  emoji: "✕", color: colors.ink },
];

export default function RateItemsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    restaurant_id: string;
    visit_id?: string;
    name?: string;
  }>();

  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Record<string, ItemRating>>({});
  const [savedCount, setSavedCount] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newPending, setNewPending] = useState<ItemRating | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!params.restaurant_id) { setLoading(false); return; }
    try {
      setItems(await listForRestaurant(params.restaurant_id, 30));
    } catch {
      // Swallow — empty list is fine; user can still add new ones.
    } finally {
      setLoading(false);
    }
  }, [params.restaurant_id]);

  useEffect(() => { load(); }, [load]);

  async function handleRate(item: MenuItem, rating: ItemRating) {
    if (busyKey) return;
    setBusyKey(item.id);
    setPending((p) => ({ ...p, [item.id]: rating }));
    try {
      await rateItem({
        menuItemId: item.id,
        visitId: params.visit_id ?? null,
        rating,
      });
      void triggerHapticSelection();
      setSavedCount((n) => n + 1);
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message ?? "Try again");
      setPending((p) => { const c = { ...p }; delete c[item.id]; return c; });
    } finally {
      setBusyKey(null);
    }
  }

  async function handleAddNew() {
    if (!newName.trim() || !newPending || adding || !params.restaurant_id) return;
    setAdding(true);
    try {
      const created = await addAndRate({
        restaurantId: params.restaurant_id,
        visitId: params.visit_id ?? null,
        name: newName,
        rating: newPending,
      });
      setItems((curr) => [{ ...created, visit_count: created.visit_count + 1 }, ...curr.filter((i) => i.id !== created.id)]);
      setPending((p) => ({ ...p, [created.id]: newPending }));
      setSavedCount((n) => n + 1);
      setNewName("");
      setNewPending(null);
      void triggerHapticSuccess();
    } catch (e: any) {
      Alert.alert("Couldn't add", e.message ?? "Try again");
    } finally {
      setAdding(false);
    }
  }

  function done() {
    router.back();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>WHAT DID YOU GET?</Text>
        {params.name && <Text style={styles.title}>{params.name}</Text>}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
        ) : (
          <>
            {/* Add-your-own row — leads the list because most visits won't
                have items in the catalog yet. */}
            <View style={styles.addCard}>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="What did you eat?"
                placeholderTextColor={colors.mute}
                style={styles.addInput}
                autoCapitalize="words"
                autoCorrect={false}
              />
              <View style={styles.ratingRow}>
                {RATINGS.map((r) => (
                  <RatingChip
                    key={r.key}
                    label={r.label}
                    emoji={r.emoji}
                    selected={newPending === r.key}
                    onPress={() => setNewPending(r.key)}
                    disabled={adding}
                  />
                ))}
              </View>
              <Spacer size={10} />
              <Button
                title={adding ? "Adding…" : "Add"}
                onPress={handleAddNew}
                loading={adding}
                disabled={!newName.trim() || !newPending}
              />
            </View>

            {items.length > 0 && (
              <Text style={[type.micro, { marginTop: spacing.lg, marginBottom: 6 }]}>
                OR PICK FROM WHAT OTHERS GOT
              </Text>
            )}

            {items.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                <View style={styles.itemRatingRow}>
                  {RATINGS.map((r) => (
                    <RatingChip
                      key={r.key}
                      label={r.label}
                      emoji={r.emoji}
                      selected={pending[item.id] === r.key}
                      onPress={() => handleRate(item, r.key)}
                      disabled={busyKey === item.id}
                      compact
                    />
                  ))}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.footerNote}>
          {savedCount === 0
            ? "Optional — these sharpen your Palate."
            : `${savedCount} saved · sharpening your Palate.`}
        </Text>
        <Button title={savedCount === 0 ? "Skip" : "Done"} onPress={done} variant="ghost" />
      </View>
    </SafeAreaView>
  );
}

function RatingChip({
  label, emoji, selected, onPress, disabled, compact,
}: {
  label: string; emoji: string; selected: boolean;
  onPress: () => void; disabled?: boolean; compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.chip,
        compact && styles.chipCompact,
        selected && styles.chipSelected,
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {emoji}{compact ? "" : `  ${label}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
  },
  eyebrow: { ...type.micro, color: colors.red },
  title: { fontSize: 22, fontWeight: "800", color: colors.ink, marginTop: 6, letterSpacing: -0.5 },

  body: { padding: spacing.lg, paddingBottom: 40 },
  center: { padding: 60, alignItems: "center" },

  addCard: {
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.faint,
    borderWidth: 1, borderColor: colors.line,
  },
  addInput: {
    height: 44, borderRadius: 12,
    borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 12, fontSize: 15, color: colors.ink,
    backgroundColor: colors.paper,
    marginBottom: 10,
  },

  ratingRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },

  itemRow: {
    paddingVertical: 14,
    borderTopColor: colors.line, borderTopWidth: 1,
  },
  itemName: { fontSize: 15, fontWeight: "700", color: colors.ink, marginBottom: 8 },
  itemRatingRow: { flexDirection: "row", gap: 6 },

  chip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.line,
  },
  chipCompact: { paddingHorizontal: 14, paddingVertical: 7 },
  chipSelected: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  chipText: { fontSize: 13, fontWeight: "700", color: colors.ink },
  chipTextSelected: { color: "#fff" },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopColor: colors.line, borderTopWidth: 1,
    backgroundColor: colors.paper,
  },
  footerNote: { ...type.small, marginBottom: 8, textAlign: "center" },
});
