import { useEffect, useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Text } from "./Text";
import { useRouter } from "expo-router";
import { colors, spacing, type, card, radius, shadow } from "../theme";
import { topRankedPlaces, type TopPlace } from "../lib/rankings-store";
import { triggerHapticSelection } from "../lib/haptics";

// ============================================================================
// TopFive — the ranked list, where identity actually lives.
// ----------------------------------------------------------------------------
// THE LETTERBOXD LESSON. Letterboxd won on ranked lists as identity: the thing
// worth looking at on a stranger's page, and the reason to keep curating your
// own. Palate has had a ranked list since 0062 and it was reachable only from
// a button in Settings — which is where features go to be forgotten.
//
// Same component on your profile and on someone else's, because it should be
// the same object. The only differences are the heading and whether an empty
// list invites you to do something about it.
//
// Beli's equivalent list costs its users manual labour forever. Ours falls out
// of passive capture plus one question at a time — but that advantage only
// exists if the list is somewhere people see it.
// ============================================================================

export function TopFive({
  userId,
  mine,
  displayName,
}: {
  /** Omit on your own profile — it resolves to the signed-in user. */
  userId?: string;
  /** Your own profile, which changes the heading and the empty state. */
  mine: boolean;
  /** Used in the heading on someone else's profile. */
  displayName?: string | null;
}) {
  const router = useRouter();
  const [places, setPlaces] = useState<TopPlace[] | null>(null);

  useEffect(() => {
    if (!mine && !userId) return;
    let alive = true;
    void topRankedPlaces(userId, 5)
      .then((rows) => { if (alive) setPlaces(rows); })
      .catch(() => { if (alive) setPlaces([]); });
    return () => { alive = false; };
  }, [userId, mine]);

  // Still loading, or nothing to show. On someone else's profile an empty list
  // renders nothing at all: a private list and an unranked one look identical
  // from here, which is the point.
  if (places === null) return null;
  if (places.length === 0 && !mine) return null;

  return (
    <View style={styles.box}>
      <Text style={styles.heading}>{headingFor(mine, displayName)}</Text>

      {places.length === 0 ? (
        // Only ever shown on your own profile, and it names the one action
        // that fills it rather than describing the feature.
        <Pressable
          onPress={() => { void triggerHapticSelection(); router.push("/rankings" as never); }}
          accessibilityRole="button"
        >
          <Text style={styles.emptyLine}>
            Log two meals and we&apos;ll start asking which you preferred. That&apos;s
            what builds this list.
          </Text>
        </Pressable>
      ) : (
        places.map((p) => (
          <Pressable
            key={p.googlePlaceId}
            style={styles.row}
            onPress={() => {
              void triggerHapticSelection();
              router.push(`/restaurant/${p.googlePlaceId}` as never);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Number ${p.position}, ${p.name}. Open place details.`}
          >
            <Text style={styles.rank}>{p.position}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
              {!!p.cuisine && <Text style={styles.meta} numberOfLines={1}>{p.cuisine}</Text>}
            </View>
          </Pressable>
        ))
      )}

      {mine && places.length > 0 && (
        <Pressable
          onPress={() => { void triggerHapticSelection(); router.push("/rankings" as never); }}
          style={styles.moreBtn}
          accessibilityRole="button"
        >
          <Text style={styles.moreText}>See the whole list  →</Text>
        </Pressable>
      )}
    </View>
  );
}

/** "Your", "Marcus's", "Chris'", or a plain "Their" when we have no name —
 *  never "Their's". */
function headingFor(mine: boolean, displayName?: string | null): string {
  if (mine) return "Your top places";
  const who = displayName?.trim();
  if (!who) return "Their top places";
  return `${who.endsWith("s") ? `${who}'` : `${who}'s`} top places`;
}

const styles = StyleSheet.create({
  box: {
    padding: card.padding, borderRadius: card.radius,
    backgroundColor: colors.faint, marginTop: spacing.md, ...shadow.card,
  },
  heading: { fontSize: 15, fontWeight: "800", color: colors.ink, marginBottom: 8 },
  emptyLine: { ...type.small, lineHeight: 19 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    minHeight: 40, paddingVertical: 6,
  },
  rank: {
    fontSize: 15, fontWeight: "800", color: colors.mute,
    minWidth: 18, textAlign: "center",
  },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink },
  meta: { ...type.small, marginTop: 1 },
  moreBtn: {
    alignSelf: "flex-start", marginTop: 8,
    paddingHorizontal: 12, minHeight: 36, paddingVertical: 8,
    borderRadius: radius.full, backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.line, justifyContent: "center",
  },
  moreText: { fontSize: 13, fontWeight: "700", color: colors.ink },
});
