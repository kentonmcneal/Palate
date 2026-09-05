import { Alert } from "react-native";
import { dislikePlace, REASON_LABEL, type DislikeReason } from "../lib/dislikes";
import { invalidatePersonalSignal } from "../lib/personal-signal";
import { invalidateCompatibilityCache } from "../lib/recommendation";
import { trackRecEvent } from "../lib/recommendation-events";
import { triggerHapticSelection } from "../lib/haptics";

// The one "Not interested" flow, shared by every surface that shows a
// recommendation. One tap asks why, because the why is what the app learns
// from: "not into this food" teaches the cuisine, "too pricey" the tier,
// "wrong kind of place" the format, "just this place" a little of each.
// Native alert rather than a custom sheet: four choices, one moment.
export function askNotInterested(
  place: { google_place_id: string; name: string },
  opts: { surface?: string; onDone?: () => void } = {},
): void {
  void triggerHapticSelection();
  const choose = (reason: DislikeReason) => {
    void (async () => {
      try {
        await dislikePlace(place.google_place_id, reason);
        void trackRecEvent("recommendation_dismissed", place.google_place_id, { surface: opts.surface as never, reason });
        invalidatePersonalSignal();
        invalidateCompatibilityCache();
        opts.onDone?.();
      } catch (e: any) {
        Alert.alert("Couldn't hide that", e?.message ?? "Try again");
      }
    })();
  };
  Alert.alert(
    `Not interested in ${place.name}?`,
    "It goes away for good, and Palate learns from why. You can bring it back in Settings.",
    [
      { text: REASON_LABEL.food, onPress: () => choose("food") },
      { text: REASON_LABEL.price, onPress: () => choose("price") },
      { text: REASON_LABEL.vibe, onPress: () => choose("vibe") },
      { text: REASON_LABEL.place, onPress: () => choose("place") },
      { text: "Cancel", style: "cancel" },
    ],
  );
}
