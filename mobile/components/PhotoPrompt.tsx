import { useState } from "react";
import { View, StyleSheet, Pressable, Image, Alert, ActivityIndicator } from "react-native";
import { Text } from "./Text";
import * as ImagePicker from "expo-image-picker";
import { colors, card, radius, shadow, type } from "../theme";
import { attachPhotoToVisit } from "../lib/visits";
import { invalidatePlacePhoto } from "../lib/place-photos";
import { triggerHapticSuccess } from "../lib/haptics";

// ============================================================================
// PhotoPrompt — ask for the photo while the food is still on the table.
// ----------------------------------------------------------------------------
// Everything needed to attach a photo to a visit already existed: the column,
// the bucket, the upload function, two screens that render them. And 0 of 47
// visits had one, because the only way in was buried on the visit-detail
// screen, which a person reaches by deliberately going to look at a meal they
// already logged. Nobody does that.
//
// So it moves to the moment of logging. This is the only point where the food
// is physically in front of the person, and it is the difference between a
// feature that exists and a feature that gets used.
//
// Rules it follows, because a prompt at this moment is easy to get wrong:
//   • never blocks — "Skip" is always right there, and the flow continues
//   • never nags — one ask per visit, no retry, no badge
//   • failure is silent to the user's progress; the visit is already saved
// ============================================================================

export function PhotoPrompt({
  visitId,
  placeId,
  placeName,
}: {
  visitId: string;
  /** Invalidated on success so the new photo shows on cards immediately. */
  placeId?: string | null;
  placeName?: string | null;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  async function pick(source: "camera" | "library") {
    const perm = source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      // Declining here must not derail the flow — drop the prompt and move on.
      setDismissed(true);
      return;
    }

    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          // 0.5 keeps an iPhone photo around a few hundred KB rather than
          // several MB. Storage is the free tier and this is card art, not a
          // print. Deliberately not adding expo-image-manipulator: it is a
          // native module, and staying JS-only keeps this shippable as an OTA.
          quality: 0.5,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.5,
        });
    if (result.canceled || !result.assets[0]) return;

    setBusy(true);
    try {
      await attachPhotoToVisit(visitId, result.assets[0].uri);
      if (placeId) invalidatePlacePhoto(placeId);
      setUri(result.assets[0].uri);
      void triggerHapticSuccess();
    } catch (e: unknown) {
      // The visit itself is already saved; only the photo failed.
      Alert.alert("Couldn't attach the photo", "Your visit was still saved.");
      setDismissed(true);
    } finally {
      setBusy(false);
    }
  }

  if (uri) {
    return (
      <View style={styles.card}>
        <Image source={{ uri }} style={styles.preview} resizeMode="cover" />
        <Text style={styles.done}>Photo added ✓</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {placeName ? `Snap your meal at ${placeName}?` : "Snap your meal?"}
      </Text>
      <Text style={styles.sub}>
        Your photos are what make the app look like yours.
      </Text>
      <View style={styles.row}>
        <Pressable
          onPress={() => void pick("camera")}
          disabled={busy}
          style={[styles.primary, busy && styles.disabled]}
          accessibilityRole="button"
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryText}>Take a photo</Text>}
        </Pressable>
        <Pressable
          onPress={() => void pick("library")}
          disabled={busy}
          style={styles.ghost}
          accessibilityRole="button"
        >
          <Text style={styles.ghostText}>Choose</Text>
        </Pressable>
        <Pressable
          onPress={() => setDismissed(true)}
          style={styles.skip}
          accessibilityRole="button"
          accessibilityLabel="Skip adding a photo"
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: card.padding,
    borderRadius: card.radius,
    backgroundColor: colors.faint,
    marginBottom: 14,
    ...shadow.card,
  },
  title: { fontSize: 16, fontWeight: "800", color: colors.ink },
  sub: { ...type.small, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" },
  primary: {
    paddingHorizontal: 16, minHeight: 40, paddingVertical: 10,
    borderRadius: radius.full, backgroundColor: colors.red, justifyContent: "center",
  },
  primaryText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.6 },
  ghost: {
    paddingHorizontal: 14, minHeight: 40, paddingVertical: 10,
    borderRadius: radius.full, backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.line, justifyContent: "center",
  },
  ghostText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  skip: { paddingHorizontal: 8, paddingVertical: 10 },
  skipText: { color: colors.mute, fontSize: 13, fontWeight: "600" },
  preview: { width: "100%", height: 160, borderRadius: radius.md },
  done: { ...type.small, marginTop: 8, color: colors.ink, fontWeight: "700" },
});
