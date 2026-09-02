import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { categoryColors, radius } from "../theme";

// ============================================================================
// PlaceArt — generated card art, standing in for photography.
// ----------------------------------------------------------------------------
// Airbnb, OpenTable, Resy and Beli are all photo-forward, and without images a
// restaurant app reads as a list of text no matter how good the typography is.
// Real photos mean the Google Places Photo API, which bills per request and so
// scales with impressions — the wrong cost shape for a feed.
//
// This is the honest substitute: a cuisine-derived gradient with the place's
// initials set large. It is not a photo and does not pretend to be one. What it
// buys is that a scrolling feed becomes visual and, more usefully, that a
// cuisine becomes RECOGNISABLE — Thai is always the same green, Italian always
// the same terracotta — so the feed is scannable by colour before it is read.
//
// DETERMINISTIC, which is the whole trick. Art is derived from the place id, so
// the same restaurant looks identical on Home, in Discover, and on its own
// page. Random-per-render art would read as noise and would flicker between
// screens.
// ============================================================================

const PALETTE = [
  categoryColors.terracotta,
  categoryColors.saffron,
  categoryColors.olive,
  categoryColors.pine,
  categoryColors.plum,
  categoryColors.clay,
] as const;

/** Cuisines we can name get a fixed hue, so the mapping is meaningful rather
 *  than arbitrary. Anything unrecognised falls back to the id hash — still
 *  stable, just not semantic. */
const CUISINE_HUE: Record<string, string> = {
  italian: categoryColors.terracotta,
  pizza: categoryColors.terracotta,
  mexican: categoryColors.clay,
  spanish: categoryColors.clay,
  latin: categoryColors.clay,
  indian: categoryColors.saffron,
  thai: categoryColors.pine,
  vietnamese: categoryColors.pine,
  chinese: categoryColors.plum,
  japanese: categoryColors.plum,
  sushi: categoryColors.plum,
  korean: categoryColors.plum,
  american: categoryColors.olive,
  bbq: categoryColors.clay,
  steakhouse: categoryColors.terracotta,
  seafood: categoryColors.pine,
  mediterranean: categoryColors.olive,
  greek: categoryColors.olive,
  french: categoryColors.plum,
  cafe: categoryColors.saffron,
  bakery: categoryColors.saffron,
  dessert: categoryColors.saffron,
};

/** Stable string hash. Same input, same colour, forever. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function baseColor(seed: string, cuisine?: string | null): string {
  const key = (cuisine ?? "").toLowerCase().trim();
  for (const [name, color] of Object.entries(CUISINE_HUE)) {
    if (key.includes(name)) return color;
  }
  return PALETTE[hash(seed) % PALETTE.length];
}

/** Darken a hex colour toward black by `amount` (0..1), for the gradient's
 *  far end. Keeps the two stops obviously related rather than two hues. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Up to two initials — the visual anchor. Skips leading articles, so
 *  "The Anchor" reads AN rather than TH. */
export function initialsOf(name: string): string {
  const words = (name ?? "")
    // Apostrophes CLOSE UP rather than becoming spaces: "Tony's" is one word,
    // and splitting it yields "TS", which is not what anyone would draw.
    .replace(/['\u2019`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  const meaningful = words.filter(
    (w) => !["the", "a", "an", "el", "la", "le"].includes(w.toLowerCase()),
  );
  // An article-only name ("The") still deserves its letter.
  const src = meaningful.length ? meaningful : words;

  // No letters or digits at all — emoji, punctuation, whitespace. Anything we
  // returned here would be junk on the card, so say so.
  if (src.length === 0) return "?";
  if (src.length === 1) return src[0].slice(0, 2).toUpperCase();
  return (src[0][0] + src[1][0]).toUpperCase();
}

export function PlaceArt({
  seed,
  name,
  cuisine,
  height = 132,
  rounded = true,
}: {
  /** Stable identity — pass google_place_id. */
  seed: string;
  name: string;
  cuisine?: string | null;
  height?: number;
  rounded?: boolean;
}) {
  const base = baseColor(seed, cuisine);
  // A slight per-place angle shift so a column of same-cuisine cards doesn't
  // look like one repeated tile.
  const flip = hash(seed) % 2 === 0;

  return (
    <View
      style={[
        styles.wrap,
        { height },
        rounded && { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
      ]}
      // Decorative: the name is already read out by the row beneath it, and
      // announcing initials would just be noise to a screen reader.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <LinearGradient
        colors={[base, shade(base, 0.45)]}
        start={flip ? { x: 0, y: 0 } : { x: 1, y: 0 }}
        end={flip ? { x: 1, y: 1 } : { x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Text style={styles.initials} allowFontScaling={false}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 44,
    fontWeight: "800",
    letterSpacing: -1,
  },
});
