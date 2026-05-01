import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Alert, Image, TextInput, Linking, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Button, Spacer } from "../../components/Button";
import { colors, spacing, type } from "../../theme";
import { supabase } from "../../lib/supabase";
import {
  recentVisits,
  updateVisit,
  deleteVisit,
  attachPhotoToVisit,
  type Visit,
} from "../../lib/visits";
import { searchRestaurants, type Restaurant } from "../../lib/places";

export default function VisitDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const visitId = id as string;

  const [visit, setVisit] = useState<Visit | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingPlace, setEditingPlace] = useState(false);
  const [editingTime, setEditingTime] = useState(false);
  const [pickerMode, setPickerMode] = useState<"date" | "time">("date");

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("visits")
        .select(`
          id, user_id, restaurant_id, visited_at, meal_type, detection_source,
          confirmed_by_user, notes, photo_url,
          restaurant:restaurants (
            id, name, chain_name, address, primary_type, google_place_id,
            cuisine_type, neighborhood, rating
          )
        `)
        .eq("id", visitId)
        .maybeSingle();
      if (error) throw error;
      const v = data as unknown as Visit | null;
      setVisit(v);
      setNoteDraft(v?.notes ?? "");
    } catch (e: any) {
      console.warn("visit load", e?.message);
    } finally {
      setLoading(false);
    }
  }, [visitId]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  async function pickPhoto(source: "camera" | "library") {
    const perm = source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Access off", "Allow access in Settings → Palate.", [
        { text: "Open Settings", onPress: () => Linking.openSettings() },
        { text: "Not now" },
      ]);
      return;
    }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      const url = await attachPhotoToVisit(visitId, result.assets[0].uri);
      setVisit((curr) => curr ? { ...curr, photo_url: url } : curr);
    } catch (e: any) {
      Alert.alert("Couldn't attach", e?.message ?? "Try again");
    } finally {
      setUploading(false);
    }
  }

  async function saveNote() {
    setEditingNote(false);
    try {
      await updateVisit(visitId, { notes: noteDraft.trim() || null });
      setVisit((curr) => curr ? { ...curr, notes: noteDraft.trim() || null } : curr);
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "Try again");
    }
  }

  async function changeRestaurant(p: Restaurant) {
    setEditingPlace(false);
    try {
      await updateVisit(visitId, { googlePlaceId: p.google_place_id });
      await load();
    } catch (e: any) {
      Alert.alert("Couldn't change", e?.message ?? "Try again");
    }
  }

  async function handleTimeChange(_ev: any, selected?: Date) {
    // iOS keeps the picker open; Android closes after a single pick.
    if (Platform.OS !== "ios") setEditingTime(false);
    if (!selected) return;
    try {
      await updateVisit(visitId, { visitedAt: selected });
      setVisit((curr) => curr ? { ...curr, visited_at: selected.toISOString() } : curr);
    } catch (e: any) {
      Alert.alert("Couldn't update time", e?.message ?? "Try again");
    }
  }

  function confirmDelete() {
    Alert.alert("Delete this visit?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await deleteVisit(visitId);
            router.back();
          } catch (e: any) {
            Alert.alert("Couldn't delete", e?.message ?? "Try again");
          }
        },
      },
    ]);
  }

  function pickPhotoSource() {
    Alert.alert(
      "Add a photo",
      undefined,
      [
        { text: "Take photo", onPress: () => pickPhoto("camera") },
        { text: "Choose from library", onPress: () => pickPhoto("library") },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.red} /></View>
      </SafeAreaView>
    );
  }

  if (!visit) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><Text style={type.subtitle}>Visit not found.</Text></View>
      </SafeAreaView>
    );
  }

  const r = visit.restaurant;
  const dt = new Date(visit.visited_at);

  if (editingPlace) {
    return <PlaceSearchSheet onPick={changeRestaurant} onCancel={() => setEditingPlace(false)} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Visit</Text>
        <Pressable onPress={confirmDelete} style={styles.deleteBtn}>
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {visit.photo_url ? (
          <Pressable onPress={pickPhotoSource}>
            <Image source={{ uri: visit.photo_url }} style={styles.photo} />
            <View style={styles.photoOverlay}>
              <Text style={styles.photoOverlayText}>Tap to replace</Text>
            </View>
          </Pressable>
        ) : (
          <Pressable onPress={pickPhotoSource} style={styles.photoEmpty}>
            <Text style={styles.photoEmptyEmoji}>📷</Text>
            <Text style={styles.photoEmptyText}>
              {uploading ? "Uploading…" : "Add a photo of what you ate"}
            </Text>
          </Pressable>
        )}

        <Spacer />

        {/* Restaurant */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={type.micro}>RESTAURANT</Text>
              <Text style={styles.placeName}>{r?.name ?? "Unknown"}</Text>
              <Text style={[type.small, { marginTop: 4 }]} numberOfLines={2}>
                {[r?.cuisine_type ? capitalize(r.cuisine_type) : null, r?.neighborhood, r?.address]
                  .filter(Boolean).join(" · ") || "—"}
              </Text>
            </View>
            <Pressable onPress={() => setEditingPlace(true)} style={styles.editPill}>
              <Text style={styles.editPillText}>Change</Text>
            </Pressable>
          </View>
        </View>

        {/* When */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={type.micro}>WHEN</Text>
              <Text style={styles.whenText}>
                {dt.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
              </Text>
              <Text style={[type.small, { marginTop: 4 }]}>
                {dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {capitalize(visit.meal_type)}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Pressable onPress={() => { setPickerMode("date"); setEditingTime(true); }} style={styles.editPill}>
                <Text style={styles.editPillText}>Date</Text>
              </Pressable>
              <Pressable onPress={() => { setPickerMode("time"); setEditingTime(true); }} style={styles.editPill}>
                <Text style={styles.editPillText}>Time</Text>
              </Pressable>
            </View>
          </View>
          {editingTime && (
            <DateTimePicker
              value={dt}
              mode={pickerMode}
              display={Platform.OS === "ios" ? "spinner" : "default"}
              maximumDate={new Date()}
              onChange={handleTimeChange}
            />
          )}
          {editingTime && Platform.OS === "ios" && (
            <Pressable onPress={() => setEditingTime(false)} style={[styles.editPill, { alignSelf: "flex-end", marginTop: 4 }]}>
              <Text style={styles.editPillText}>Done</Text>
            </Pressable>
          )}
        </View>

        {/* Notes */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={type.micro}>NOTES</Text>
            {!editingNote && (
              <Pressable onPress={() => setEditingNote(true)} style={styles.editPill}>
                <Text style={styles.editPillText}>{visit.notes ? "Edit" : "Add"}</Text>
              </Pressable>
            )}
          </View>
          {editingNote ? (
            <>
              <TextInput
                value={noteDraft}
                onChangeText={setNoteDraft}
                placeholder="What was good?"
                placeholderTextColor={colors.mute}
                multiline
                maxLength={500}
                style={styles.noteInput}
                autoFocus
              />
              <View style={styles.noteRow}>
                <Pressable onPress={() => { setEditingNote(false); setNoteDraft(visit.notes ?? ""); }} style={styles.noteCancel}>
                  <Text style={styles.noteCancelText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={saveNote} style={styles.noteSave}>
                  <Text style={styles.noteSaveText}>Save</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Text style={[type.body, { marginTop: 8, color: visit.notes ? colors.ink : colors.mute }]}>
              {visit.notes ?? "No notes yet."}
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ----------------------------------------------------------------------------
// Inline place-search sheet for changing the visit's restaurant.
// ----------------------------------------------------------------------------
function PlaceSearchSheet({
  onPick,
  onCancel,
}: {
  onPick: (p: Restaurant) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Restaurant[]>([]);
  const [searching, setSearching] = useState(false);

  async function doSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      setResults(await searchRestaurants(query.trim()));
    } catch (e: any) {
      Alert.alert("Search failed", e?.message ?? "Try again");
    } finally {
      setSearching(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={onCancel} style={styles.closeBtn}>
          <Text style={styles.closeText}>←</Text>
        </Pressable>
        <Text style={type.title}>Change restaurant</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={{ padding: spacing.lg }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search restaurants…"
          placeholderTextColor={colors.mute}
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={doSearch}
          autoFocus
          autoCapitalize="words"
        />
        <Spacer size={10} />
        <Button title={searching ? "Searching…" : "Search"} onPress={doSearch} loading={searching} />
        <Spacer />
        {results.map((p) => (
          <Pressable key={p.google_place_id} onPress={() => onPick(p)} style={styles.resultRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.placeName}>{p.name}</Text>
              {p.address && <Text style={type.small}>{p.address}</Text>}
            </View>
            <Text style={styles.add}>+</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
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
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.faint,
  },
  closeText: { fontSize: 18, fontWeight: "700", color: colors.ink },
  deleteBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  deleteText: { color: colors.red, fontSize: 13, fontWeight: "700" },
  body: { padding: spacing.lg, paddingBottom: 80 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  photo: { width: "100%", aspectRatio: 4/3, borderRadius: 18, backgroundColor: colors.faint },
  photoOverlay: {
    position: "absolute", bottom: 8, right: 8,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  photoOverlayText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  photoEmpty: {
    aspectRatio: 4/3,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.line,
    backgroundColor: colors.faint,
    alignItems: "center", justifyContent: "center",
  },
  photoEmptyEmoji: { fontSize: 40 },
  photoEmptyText: { ...type.small, marginTop: 8 },

  card: {
    marginBottom: 12,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.line,
  },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  placeName: { fontSize: 18, fontWeight: "800", color: colors.ink, marginTop: 4 },
  editPill: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: colors.faint, borderWidth: 1, borderColor: colors.line,
  },
  editPillText: { fontSize: 12, fontWeight: "700", color: colors.ink },
  whenText: { fontSize: 16, fontWeight: "700", color: colors.ink, marginTop: 6 },

  noteInput: {
    marginTop: 8,
    minHeight: 80,
    borderRadius: 12,
    borderWidth: 1, borderColor: colors.line,
    padding: 12, fontSize: 15, color: colors.ink,
    textAlignVertical: "top",
  },
  noteRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  noteCancel: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.faint, alignItems: "center" },
  noteCancelText: { fontSize: 13, fontWeight: "700", color: colors.mute },
  noteSave: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.red, alignItems: "center" },
  noteSaveText: { fontSize: 13, fontWeight: "700", color: "#fff" },

  searchInput: {
    height: 50, borderRadius: 14, borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 16, fontSize: 16, color: colors.ink,
  },
  resultRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 14,
    borderBottomColor: colors.line, borderBottomWidth: 1,
  },
  add: { fontSize: 24, color: colors.red, fontWeight: "700", marginLeft: 12 },
});
