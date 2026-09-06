import { View, Image, StyleSheet } from "react-native";
import { Text } from "./Text";
import { colors } from "../theme";
import { cuisineHue } from "./PlaceArt";

// ============================================================================
// FeedAvatar: a person's avatar, with a hue of their own when there is no photo.
// ----------------------------------------------------------------------------
// The shared Avatar paints every initial tile the one brand red, which on a
// feed means a column of identical red circles: twelve posts by twelve people
// all wearing the same badge, and the red stops meaning "primary action"
// because it is everywhere. This is the feed's own copy so the shared one,
// used by thirteen other screens, does not change under them.
//
// The hue comes from the person's name through the same hash PlaceArt uses
// for a place with no known cuisine, so it is stable: the same person is the
// same colour on every post, today and next week, and two people next to each
// other are usually different. Brand red is reserved for the CTA, the match
// chip and the active Kudos.
// ============================================================================

type Props = {
  uri?: string | null;
  name?: string | null;
  size?: number;
};

/** The colour a person's initial tile wears. Exported so anything else on
 *  the feed that wants to echo the person (a border, a dot) matches. */
export function personHue(name?: string | null): string {
  // cuisineHue with no cuisine hashes the seed alone, which is the whole
  // point: nobody's display name should accidentally match a cuisine word and
  // pick up a semantic colour they did not earn.
  return cuisineHue(null, (name ?? "").trim().toLowerCase());
}

export function FeedAvatar({ uri, name, size = 40 }: Props) {
  const radius = size / 2;
  const fontSize = Math.max(12, size * 0.4);
  const initial = pickInitial(name);

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.image, { width: size, height: size, borderRadius: radius }]}
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: radius, backgroundColor: personHue(name) }]}>
      <Text style={[styles.fallbackText, { fontSize }]} allowFontScaling={false}>{initial}</Text>
    </View>
  );
}

function pickInitial(name?: string | null): string {
  const s = (name ?? "").trim();
  return s ? s[0].toUpperCase() : "?";
}

const styles = StyleSheet.create({
  // Wash, not white: the image loads onto a white card, and a white ground
  // would be an invisible hole until the bytes arrive.
  image: { backgroundColor: colors.wash },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackText: {
    color: "#fff",
    fontWeight: "800",
  },
});
