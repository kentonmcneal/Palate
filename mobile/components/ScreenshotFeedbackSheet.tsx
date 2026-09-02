import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "../theme";

// ============================================================================
// ScreenshotFeedbackSheet — a light prompt shown after the user screenshots.
// ----------------------------------------------------------------------------
// Deliberately NOT a modal: it slides in over the bottom of whatever screen
// the user is on, doesn't take focus, and doesn't block a single tap anywhere
// else. Someone screenshotting a restaurant to text a friend should be able to
// ignore this completely; someone screenshotting a bug gets a one-tap route to
// the form. It also auto-dismisses, so ignoring it costs nothing.
// ============================================================================

const AUTO_DISMISS_MS = 8000;

export function ScreenshotFeedbackSheet({
  visible,
  onSend,
  onDismiss,
}: {
  visible: boolean;
  onSend: () => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: visible ? 260 : 180,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();

    if (!visible) return;
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [visible, slide, onDismiss]);

  if (!visible) return null;

  return (
    <Animated.View
      // pointerEvents="box-none" on the wrapper keeps the rest of the screen
      // fully interactive while the sheet is up.
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { paddingBottom: insets.bottom + 12 },
        {
          opacity: slide,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) }],
        },
      ]}
    >
      <View style={styles.card}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Saw a screenshot — something off?</Text>
          <Text style={styles.sub}>Takes 20 seconds and goes straight to us.</Text>
        </View>
        <Pressable
          onPress={onSend}
          style={styles.primary}
          accessibilityRole="button"
          accessibilityLabel="Send feedback about this screen"
        >
          <Text style={styles.primaryText}>Send feedback</Text>
        </Pressable>
        <Pressable
          onPress={onDismiss}
          style={styles.dismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <Text style={styles.dismissText}>✕</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.md,
  },
  card: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    paddingVertical: 12, paddingHorizontal: 14,
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  title: { color: "#fff", fontSize: 14, fontWeight: "700" },
  sub: { color: "rgba(255,255,255,0.66)", fontSize: 12, marginTop: 2 },
  primary: {
    backgroundColor: colors.red,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
  },
  primaryText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  dismiss: { padding: 4 },
  dismissText: { color: "rgba(255,255,255,0.5)", fontSize: 14, fontWeight: "700" },
});
