import { View, StyleSheet, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { CanvasText } from "./CanvasText";
import type { TopPlace } from "../lib/rankings-store";

// ============================================================================
// TopFiveShareCard — the ranked list, made postable.
// ----------------------------------------------------------------------------
// This is the Letterboxd artifact. A ranked list is the rare piece of app
// output somebody wants to put their name on, because it is an ARGUMENT: five
// places in an order, which is a claim other people can disagree with. A
// screenshot of a score says something happened to you; this says something
// about you.
//
// It deliberately shows only names and order — no ratings, no comparison
// counts. The Elo numbers are internal bookkeeping and would invite the wrong
// conversation ("why is that a 1520"), where the order invites the right one
// ("that's your number two?").
//
// 9:16 and captured by the parent via react-native-view-shot, so every string
// is CanvasText: this becomes an image, and scaling its text to the viewer's
// accessibility setting would clip the export rather than help anyone.
// ============================================================================

const SHARE_W = Dimensions.get("window").width - 48;
const SHARE_H = SHARE_W * (16 / 9);

export function TopFiveShareCard({
  places,
  name,
}: {
  places: TopPlace[];
  name: string | null;
}) {
  return (
    <View style={styles.card} collapsable={false}>
      <LinearGradient
        colors={["#2A0E0B", "#0E0E0F"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <CanvasText style={styles.eyebrow}>MY TOP FIVE</CanvasText>
      <CanvasText style={styles.who} numberOfLines={1}>{firstNameOf(name)}</CanvasText>

      <View style={styles.list}>
        {places.slice(0, 5).map((p) => (
          <View key={p.googlePlaceId} style={styles.row}>
            <CanvasText style={styles.rank}>{p.position}</CanvasText>
            <View style={styles.rowBody}>
              <CanvasText style={styles.name} numberOfLines={2}>{p.name}</CanvasText>
              {!!p.cuisine && (
                <CanvasText style={styles.cuisine} numberOfLines={1}>{label(p.cuisine)}</CanvasText>
              )}
            </View>
          </View>
        ))}
      </View>

      <View style={{ flex: 1 }} />
      {/* Says where the order came from. "Ranked by hand" is the thing that
          makes a list arguable rather than algorithmic — and it happens to be
          true: every position was settled by a head-to-head the person
          answered. */}
      <CanvasText style={styles.footnote}>Settled one head-to-head at a time</CanvasText>
      <CanvasText style={styles.brand}>palate.app</CanvasText>
    </View>
  );
}

/** First name only — a share card with a full legal name on it leaks more than
 *  the moment needs. Same rule as MatchShareCard. */
function firstNameOf(name: string | null): string {
  const n = (name ?? "").trim();
  if (!n) return "My palate";
  return n.split(/\s+/)[0];
}

function label(slug: string): string {
  return slug
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

const styles = StyleSheet.create({
  card: {
    width: SHARE_W, height: SHARE_H,
    borderRadius: 28, padding: 28, overflow: "hidden",
  },
  eyebrow: {
    color: "rgba(255,255,255,0.55)", fontSize: 12,
    letterSpacing: 2, fontWeight: "800", marginTop: 8,
  },
  who: {
    color: "#FFFFFF", fontSize: 34, fontWeight: "800",
    letterSpacing: -1, marginTop: 6,
  },
  list: { marginTop: 30, gap: 18 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  rank: {
    color: "#FF5A4D", fontSize: 30, fontWeight: "800",
    letterSpacing: -1, minWidth: 30,
  },
  rowBody: { flex: 1, paddingTop: 3 },
  name: { color: "#FFFFFF", fontSize: 19, fontWeight: "700", lineHeight: 23 },
  cuisine: {
    color: "rgba(255,255,255,0.5)", fontSize: 13,
    fontWeight: "600", marginTop: 2,
  },
  footnote: {
    color: "rgba(255,255,255,0.5)", fontSize: 13,
    fontWeight: "600", marginBottom: 6,
  },
  brand: {
    color: "rgba(255,255,255,0.35)", fontSize: 12,
    fontWeight: "800", letterSpacing: 1.5,
  },
});
