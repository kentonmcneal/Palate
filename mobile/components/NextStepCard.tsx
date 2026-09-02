import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing, type, card, shadow } from "../theme";
import { nextStep, type NextStep } from "../lib/next-step";
import { currentPermissionState } from "../lib/passive-permissions";
import { getGmailStatus } from "../lib/gmail";
import { triggerHapticSelection } from "../lib/haptics";
import { track } from "../lib/analytics";

// ============================================================================
// NextStepCard — one instruction, at the top, for an account that isn't working
// yet.
// ----------------------------------------------------------------------------
// A new account currently sees a recommendation rail with nothing to recommend
// from, a stretch pick built on no history, and a saves rail with no saves —
// and THEN, below all of it, a getting-started block offering three CTAs of
// equal weight. Three equal choices is a menu, and a menu asks somebody to
// diagnose their own account.
//
// This renders above all of it and says exactly one thing. The choice of which
// thing is in lib/next-step.ts, pure and tested; this is only the frame.
//
// It disappears completely once the account is healthy. An onboarding card
// that never leaves becomes furniture.
// ============================================================================

export function NextStepCard({
  visitCount,
  friendCount,
}: {
  visitCount: number;
  friendCount: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState<NextStep | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // Both are free reads: a local permission check and one RPC. Nothing
      // here touches Gmail or Google Places.
      const [perms, gmail] = await Promise.all([
        currentPermissionState().catch(() => ({ whenInUse: false, always: false })),
        getGmailStatus().catch(() => ({
          connected: false, email: null, last_scanned_at: null, imported_count: 0,
        })),
      ]);
      if (!alive) return;
      setStep(nextStep({
        locationAlways: perms.always,
        locationWhenInUse: perms.whenInUse,
        gmailConnected: gmail.connected,
        gmailImported: gmail.imported_count,
        visitCount,
        friendCount,
      }));
    })();
    return () => { alive = false; };
  }, [visitCount, friendCount]);

  if (!step) return null;

  return (
    <Pressable
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`${step.title}. ${step.cta}.`}
      onPress={() => {
        void triggerHapticSelection();
        // Which step people actually act on is the only read we have on where
        // the funnel is really breaking.
        void track("next_step_tapped", { step: step.key });
        router.push(step.route as never);
      }}
    >
      <Text style={styles.eyebrow}>NEXT</Text>
      <Text style={styles.title}>{step.title}</Text>
      <Text style={styles.body}>{step.body}</Text>
      <View style={styles.cta}>
        <Text style={styles.ctaText}>{step.cta}  →</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: card.padding,
    borderRadius: card.radius,
    backgroundColor: colors.redTint,
    borderWidth: 1,
    borderColor: colors.redTintBorder,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  eyebrow: { ...type.micro, color: colors.redText },
  title: {
    fontSize: 19, fontWeight: "800", color: colors.ink,
    marginTop: 6, letterSpacing: -0.3, lineHeight: 24,
  },
  body: { ...type.small, marginTop: 6, lineHeight: 20 },
  cta: { marginTop: 12 },
  ctaText: { fontSize: 15, fontWeight: "800", color: colors.redText },
});
