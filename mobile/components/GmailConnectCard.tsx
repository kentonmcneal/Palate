import { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";
import { Text } from "./Text";
import { colors, spacing, type, card, shadow, categoryColors } from "../theme";
import { FONT_CAP } from "../lib/a11y";
import { track } from "../lib/analytics";
import { triggerHapticSelection } from "../lib/haptics";
import { getGmailStatus } from "../lib/gmail";

// ============================================================================
// GmailConnectCard — the offer, where somebody might actually see it.
// ----------------------------------------------------------------------------
// Connecting Gmail was reachable from exactly two places: a collapsed Settings
// section titled "Bring in your history", and the onboarding screen you pass
// through once. So the single fastest way to make Palate good — starting from
// meals you have already eaten instead of the ones you log from today — was
// behind a disclosure triangle, under a heading that does not say email.
//
// This is the same shape as InviteCard and sits beside it: both are the app
// asking for the thing that makes it work. It disappears the moment Gmail is
// connected; managing or disconnecting stays in Settings, which is where you
// would go looking for it.
// ============================================================================

export function GmailConnectCard() {
  const router = useRouter();
  const [connected, setConnected] = useState<boolean | null>(null);

  const load = useCallback(() => {
    void getGmailStatus()
      .then((s) => setConnected(s.connected))
      // A status we cannot read is not a reason to advertise. Staying silent
      // beats showing "connect" to somebody who already has.
      .catch(() => setConnected(true));
  }, []);

  useEffect(() => { load(); }, [load]);
  // Re-read on focus: connecting happens on another screen, and coming back to
  // a card still offering what you just did reads as though it failed.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function open() {
    void triggerHapticSelection();
    void track("gmail_card_opened", { surface: "profile" });
    router.push("/import-email");
  }

  // null while loading, true when connected: nothing to offer either way.
  if (connected !== false) return null;

  return (
    <View style={styles.card}>
      {/* Shadow outside, clip inside: iOS drops a view's own shadow when that
          view clips its children. Same build as every other card. */}
      <View style={styles.clip}>
        <View style={styles.rail} />
        <View style={styles.body}>
          <Text style={styles.eyebrow} maxFontSizeMultiplier={FONT_CAP.eyebrow}>
            ALREADY IN YOUR INBOX
          </Text>
          <Text style={styles.title}>Start from meals you have already had</Text>
          <Text style={styles.sub}>
            Reservation and delivery confirmations become visits, so your
            recommendations are worth reading before you have logged anything.
          </Text>

          <Pressable
            onPress={open}
            style={styles.cta}
            accessibilityRole="button"
            accessibilityLabel="Connect Gmail to import past restaurant visits"
          >
            <Text style={styles.ctaText} maxFontSizeMultiplier={FONT_CAP.chrome}>
              Connect Gmail
            </Text>
          </Pressable>

          <Text style={styles.fine}>
            Palate looks only for restaurant confirmations, and shows you every
            one it found before a single visit is saved.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    // No horizontal margin: ProfileBody's ScrollView already pads to
    // spacing.lg, and a margin here would inset it past every other card.
    marginTop: spacing.lg,
    borderRadius: card.radius, backgroundColor: colors.faint,
    ...shadow.card,
  },
  clip: { borderRadius: card.radius, overflow: "hidden" },
  // Terracotta, not plum: plum is the people card. This one is about food you
  // have already eaten.
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: categoryColors.terracotta },
  body: { padding: card.padding },
  eyebrow: { ...type.micro, color: categoryColors.terracotta },
  title: { ...type.cardTitle, color: colors.ink, marginTop: 6 },
  sub: { ...type.small, marginTop: 4, lineHeight: 18 },
  cta: {
    marginTop: 14, alignSelf: "flex-start",
    paddingHorizontal: 20, paddingVertical: 11,
    borderRadius: 999, backgroundColor: colors.red,
  },
  ctaText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  fine: { ...type.small, marginTop: 12, color: colors.mute, lineHeight: 17 },
});
