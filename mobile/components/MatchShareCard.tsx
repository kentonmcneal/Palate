import { View, StyleSheet, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Avatar } from "./Avatar";
import { CanvasText } from "./CanvasText";
import type { PalateMatch } from "../lib/recommendation/palate-match";

// ============================================================================
// MatchShareCard — the number, made postable.
// ----------------------------------------------------------------------------
// computePalateMatch() already produces the score and the reasons. This is the
// object someone actually sends to the person it is about, which is the only
// part that does any growth work.
//
// Borrowed from Spotify Blend, deliberately: ONE enormous number, two faces,
// and only enough underneath to make it believable. Blend works because the
// figure is the whole message — the breakdown is evidence, not content. A card
// that lists six statistics is a report, and nobody posts a report.
//
// 9:16 like SharePalateCard, captured by the parent via react-native-view-shot,
// so every string is CanvasText: this is an image, and scaling its text to a
// viewer's accessibility setting would clip the export rather than help anyone.
//
// The divergence line stays on the card on purpose. "Mexican is where you
// split" is what makes the number read as observed rather than generated, and
// it is the line that makes the other person reply.
// ============================================================================

const SHARE_W = Dimensions.get("window").width - 48;
const SHARE_H = SHARE_W * (16 / 9);

export function MatchShareCard({
  match,
  you,
  them,
}: {
  match: Extract<PalateMatch, { ready: true }>;
  you: { name: string | null; avatarUrl: string | null };
  them: { name: string | null; avatarUrl: string | null };
}) {
  const shared = match.sharedCuisines.slice(0, 3);
  const divergence = match.reasons.find((r) => r.kind === "divergence");
  const places = match.reasons.find((r) => r.kind === "shared_places");

  return (
    <View style={styles.card} collapsable={false}>
      <LinearGradient
        colors={["#2A0E0B", "#0E0E0F"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <CanvasText style={styles.eyebrow}>PALATE MATCH</CanvasText>

      <View style={styles.faces}>
        <Avatar uri={you.avatarUrl} name={you.name} email={null} size={64} />
        <View style={styles.link} />
        <Avatar uri={them.avatarUrl} name={them.name} email={null} size={64} />
      </View>

      <CanvasText style={styles.score}>{match.score}%</CanvasText>
      <CanvasText style={styles.names} numberOfLines={2}>
        {firstNameOf(you.name)} &amp; {firstNameOf(them.name)}
      </CanvasText>

      {shared.length > 0 && (
        <View style={styles.chips}>
          {shared.map((c) => (
            <View key={c} style={styles.chip}>
              <CanvasText style={styles.chipText}>{label(c)}</CanvasText>
            </View>
          ))}
        </View>
      )}

      {!!places && <CanvasText style={styles.line}>{places.label}</CanvasText>}
      {!!divergence && <CanvasText style={styles.divergence}>{divergence.label}</CanvasText>}

      <View style={{ flex: 1 }} />
      <CanvasText style={styles.brand}>palate.app</CanvasText>
    </View>
  );
}

/** First name only. A share card with two full legal names on it reads like a
 *  wedding invitation, and it leaks more than the moment needs. */
function firstNameOf(name: string | null): string {
  const n = (name ?? "").trim();
  if (!n) return "Someone";
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
    width: SHARE_W,
    height: SHARE_H,
    borderRadius: 28,
    padding: 28,
    overflow: "hidden",
    alignItems: "center",
  },
  eyebrow: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: "800",
    marginTop: 8,
  },
  faces: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 32 },
  link: { width: 26, height: 2, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)" },
  score: {
    color: "#FF5A4D",
    fontSize: 92,
    fontWeight: "800",
    letterSpacing: -3,
    marginTop: 20,
  },
  names: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 2,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 26, justifyContent: "center" },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  chipText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  line: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    textAlign: "center",
    marginTop: 22,
  },
  divergence: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    textAlign: "center",
    marginTop: 8,
    fontStyle: "italic",
  },
  brand: { color: "rgba(255,255,255,0.4)", fontSize: 12, marginBottom: 4 },
});
