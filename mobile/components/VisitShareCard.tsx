import { View, Text, StyleSheet, Image, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../theme";
import type { Visit } from "../lib/visits";

// ============================================================================
// VisitShareCard — 1080×1920 (9:16) shareable card for a single visit.
// ----------------------------------------------------------------------------
// The Letterboxd moment for restaurants. Captured via react-native-view-shot
// and shared to Stories / iMessage / etc. Premium, calm, restaurant-first.
//
// Renders off-screen via the standard ViewShot pattern in the visit detail
// page — never visible in normal layout.
// ============================================================================

// Use the device's native pixel size as a base, then we'll scale via transform
// to actual share dimensions when capturing.
const W = 1080 / 3;   // ~360 — keeps it manageable in RAM during capture
const H = 1920 / 3;   // ~640

type Props = {
  visit: Visit;
  /** Restaurant name + neighborhood, derived by caller. */
  restaurantName: string;
  neighborhood?: string | null;
  cuisine?: string | null;
  /** Optional palate identity to badge as social-signaling ("As told by a Curator"). */
  identityLabel?: string | null;
};

export function VisitShareCard({ visit, restaurantName, neighborhood, cuisine, identityLabel }: Props) {
  const dateLabel = formatDate(visit.visited_at);

  return (
    <View style={styles.card} collapsable={false}>
      <LinearGradient
        colors={["#0E0E0E", "#1A0604", "#000000"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Subtle red glow accent */}
      <View style={styles.glow} />

      {/* Top: Palate wordmark */}
      <View style={styles.header}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoP}>p</Text>
        </View>
        <Text style={styles.brand}>palate</Text>
      </View>

      {/* Body: photo or color block */}
      {visit.photo_url ? (
        <Image source={{ uri: visit.photo_url }} style={styles.photo} resizeMode="cover" />
      ) : (
        <View style={styles.photoPlaceholder}>
          <Text style={styles.photoFallback}>{initials(restaurantName)}</Text>
        </View>
      )}

      {/* Bottom: name + meta + optional notes */}
      <View style={styles.bottom}>
        <Text style={styles.eyebrow}>{dateLabel.toUpperCase()}</Text>
        <Text style={styles.name} numberOfLines={2}>{restaurantName}</Text>
        {(cuisine || neighborhood) && (
          <Text style={styles.sub}>
            {[cuisine ? cap(cuisine) : null, neighborhood].filter(Boolean).join(" · ")}
          </Text>
        )}
        {visit.notes && visit.notes.trim().length > 0 && (
          <Text style={styles.notes} numberOfLines={3}>"{visit.notes.trim()}"</Text>
        )}
        {identityLabel && (
          <View style={styles.identityChip}>
            <Text style={styles.identityChipText}>As told by a {identityLabel}</Text>
          </View>
        )}
      </View>

      <Text style={styles.footer}>palate.app</Text>
    </View>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s;
}

const styles = StyleSheet.create({
  card: {
    width: W,
    height: H,
    backgroundColor: "#000",
    borderRadius: 24,
    overflow: "hidden",
    position: "relative",
  },
  glow: {
    position: "absolute",
    top: -50,
    right: -50,
    width: W * 0.7,
    height: W * 0.7,
    borderRadius: W,
    backgroundColor: colors.red,
    opacity: 0.18,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  logoBadge: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: colors.red,
    alignItems: "center", justifyContent: "center",
  },
  logoP: { color: "#fff", fontWeight: "800", fontSize: 16 },
  brand: { color: "#fff", fontSize: 14, fontWeight: "800", letterSpacing: -0.3 },

  photo: {
    width: "100%",
    height: H * 0.42,
    marginTop: 24,
  },
  photoPlaceholder: {
    width: "100%",
    height: H * 0.42,
    marginTop: 24,
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoFallback: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 80,
    fontWeight: "800",
    letterSpacing: -2,
  },

  bottom: {
    paddingHorizontal: 28,
    paddingTop: 28,
    flex: 1,
  },
  eyebrow: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
  },
  name: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.8,
    lineHeight: 34,
    marginTop: 8,
  },
  sub: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 8,
  },
  notes: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    lineHeight: 22,
    fontStyle: "italic",
    marginTop: 16,
  },
  identityChip: {
    alignSelf: "flex-start",
    marginTop: 16,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.20)",
  },
  identityChipText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  footer: {
    position: "absolute",
    bottom: 24,
    alignSelf: "center",
    color: "rgba(255,255,255,0.42)",
    fontSize: 12,
    fontWeight: "600",
  },
});
