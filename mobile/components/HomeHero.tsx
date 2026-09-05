import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing, type } from "../theme";
import { whenLabel, type HomeState } from "../lib/home-state";

/**
 * The one thing Home is about, said once, at the top.
 *
 * Home used to open with five blocks of equal weight and let the reader work
 * out which mattered. At 9pm with two unreviewed visits, nothing else on that
 * screen is worth looking at — so this states the situation in a sentence and
 * offers at most one action. States with no task deliberately have no button:
 * a screen with nothing to do must not invent something.
 *
 * Set in Inter, like everything else. The headline was briefly Georgia, which
 * was the only serif in the app; one exception does not read as emphasis, it
 * reads as a mistake. Size and leading carry the weight instead.
 */
export function HomeHero({ state, now = new Date() }: { state: HomeState; now?: Date }) {
  const router = useRouter();
  const action = state.kind === "review" || state.kind === "activation"
    ? { cta: state.cta, route: state.route }
    : null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>{whenLabel(now).toUpperCase()}</Text>
      <Text style={styles.headline}>{state.headline}</Text>
      <Text style={styles.body}>{state.body}</Text>

      {action && (
        <Pressable
          onPress={() => router.push(action.route as never)}
          style={styles.cta}
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>{action.cta}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** A sentence, not a dashboard. Never exposes detector internals. */
export function TrackingLine({ on, lastCheck }: { on: boolean; lastCheck: string | null }) {
  return (
    <View style={styles.trackWrap}>
      <View style={[styles.dot, { backgroundColor: on ? colors.live : colors.mute }]} />
      <Text style={styles.trackText}>
        <Text style={{ color: colors.ink, fontWeight: "700" }}>
          {on ? "Tracking is on." : "Tracking is off."}
        </Text>
        {on && lastCheck ? ` Last checked ${lastCheck}.` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: spacing.sm, paddingBottom: spacing.md },
  eyebrow: {
    fontSize: 11, fontWeight: "700", letterSpacing: 1.4,
    color: colors.mute, marginBottom: 10,
  },
  headline: {
    ...type.display,
    fontSize: 30, lineHeight: 35, color: colors.ink, letterSpacing: -0.8,
  },
  body: { ...type.small, marginTop: 8, lineHeight: 20, fontSize: 14 },
  cta: {
    marginTop: spacing.md,
    backgroundColor: colors.red,
    borderRadius: 14, paddingVertical: 15, alignItems: "center",
  },
  ctaText: { color: "#fff", fontSize: 15, fontWeight: "800", letterSpacing: -0.1 },

  trackWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginTop: spacing.xl, paddingTop: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.line,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  trackText: { ...type.small, flex: 1, lineHeight: 19 },
});
