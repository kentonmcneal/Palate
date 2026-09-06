import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Text } from "./Text";
import { categoryColors, colors, spacing } from "../theme";
import { FONT_CAP, useFontScale } from "../lib/a11y";
import { track } from "../lib/analytics";
import { supabase } from "../lib/supabase";
import { currentPermissionState } from "../lib/passive-permissions";
import { notificationsGranted } from "../lib/notifications";
import { isPassiveOptedIn } from "../lib/passive-capture";
import { triggerHapticSelection } from "../lib/haptics";

// ============================================================================
// CaptureWarning: the strip that will not go away while the core feature is off.
// ----------------------------------------------------------------------------
// Passive capture is the whole product thesis, and it needs two things the
// person can switch off without ever telling us: Location set to Always, and
// notifications allowed. Everything the app already had for this was polite.
// PermissionRepairBanner appears only after a DOWNGRADE, and it has a close
// button. NextStepCard shows one step on Home, and Home is one tab of five.
// Somebody could sit on While Using with notifications denied for weeks,
// using an app that looked like it did nothing, and never be told why.
//
// This strip sits above the tab navigator, so it is on every tab, and it has
// no close button. It goes away the moment the setting is fixed and not
// before. That is deliberate: a warning you can dismiss is a warning you
// dismiss once and forget, and the point here is that nobody opts out of the
// feature by accident.
//
// One strip at a time, in priority order. Location comes first because
// notifications are worthless with nothing to notify about. Notifications
// second, because Always with no way to ask is the most wasteful state the app
// can be in: it is watching, resolving, and asking nobody.
//
// The decision (captureStatus) is pure so both this strip and the Profile
// status row read the same answer and say the same words.
// ============================================================================

export {
  captureStatus, CAPTURE_OK_BODY,
  type CaptureWarningKind, type CaptureFix, type CaptureStatus,
} from "../lib/capture-status";
import { captureStatus, type CaptureWarningKind, type CaptureStatus } from "../lib/capture-status";

/**
 * The live answer, re-read on mount, on every return to the foreground, and on
 * every focus. All three matter: the person fixes this in iOS Settings (a
 * foreground), or in one of the intro screens (a focus), and the strip has to
 * disappear the instant they come back or it reads as broken.
 *
 * Null until the first read completes, so nothing flashes red before we know.
 */
export function useCaptureStatus(): CaptureStatus | null {
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const alive = useRef(true);

  const evaluate = useCallback(async () => {
    // Every read is local: CoreLocation's status, the notification grant, and
    // an AsyncStorage flag. Nothing here touches the network.
    const [perms, notifs, optedIn] = await Promise.all([
      currentPermissionState().catch(() => ({ whenInUse: false, always: false })),
      // Fail closed on the nag, the same way Home does: if we cannot read the
      // grant, assume it is on rather than accuse somebody who said yes.
      notificationsGranted().catch(() => true),
      isPassiveOptedIn().catch(() => false),
    ]);
    if (!alive.current) return;
    setStatus(captureStatus({
      always: perms.always,
      whenInUse: perms.whenInUse,
      notifications: notifs,
      optedIn,
    }));
  }, []);

  useEffect(() => {
    alive.current = true;
    void evaluate();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void evaluate();
    });
    return () => {
      alive.current = false;
      sub.remove();
    };
  }, [evaluate]);

  useFocusEffect(useCallback(() => { void evaluate(); }, [evaluate]));

  return status;
}

/**
 * The one Fix action, shared by the strip and the Profile row so the two never
 * send people to different places for the same problem. `surface` says which
 * of them was tapped, which is the only way to learn whether a strip on every
 * tab actually converts better than a row on Profile.
 */
export function useCaptureFix(surface: "strip" | "profile" | "home_footer"): (status: CaptureStatus) => void {
  const router = useRouter();
  return useCallback((status: CaptureStatus) => {
    if (status.kind === "ok") return;
    void triggerHapticSelection();
    void track("capture_warning_fix_tapped", { kind: status.kind, surface });
    if (status.fix === "passive-intro") {
      router.push("/passive-capture-intro");
    } else if (status.fix === "notifications-intro") {
      router.push("/notifications-intro");
    } else {
      void Linking.openSettings();
    }
  }, [router, surface]);
}

/**
 * Whether somebody is signed in. The tabs can mount for a frame before the
 * root guard redirects to sign-in, and a warning about location on top of the
 * sign-in screen would be nonsense, so the strip reads the session itself.
 */
function useHasSession(): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession()
      .then(({ data }) => { if (alive) setHas(!!data.session); })
      .catch(() => {});
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (alive) setHas(!!s);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return has;
}

// Once per kind per app session. The strip is on every tab and re-evaluates on
// every focus, so without this a single unfixed permission would log a "shown"
// event on every tab switch and the count would measure navigation, not reach.
const shownKinds = new Set<CaptureWarningKind>();

export function CaptureWarning() {
  const insets = useSafeAreaInsets();
  const { stack } = useFontScale();
  const hasSession = useHasSession();
  const status = useCaptureStatus();
  const fix = useCaptureFix("strip");

  useEffect(() => {
    if (!hasSession || !status || status.kind === "ok") return;
    if (shownKinds.has(status.kind)) return;
    shownKinds.add(status.kind);
    void track("capture_warning_shown", { kind: status.kind });
  }, [hasSession, status]);

  if (!hasSession || !status || status.kind === "ok") return null;

  // Brand red is reserved for the primary CTA and for states that need
  // attention; a missing Always grant is the second. Notifications are the
  // lesser fault, so they get the amber the app already uses for ratings.
  const hue = status.kind === "location" ? colors.red : categoryColors.saffron;

  return (
    // The wrapper paints the status bar area too, so the strip reads as part
    // of the top of the screen rather than a card floating under the clock.
    // Screens below still use SafeAreaView; UIKit reports a zero top inset to
    // a view that already sits under the status bar, so nothing double-pads.
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={[styles.row, stack && styles.rowStacked]}>
        <View style={[styles.rail, { backgroundColor: hue }]} />
        <View style={styles.copy}>
          {/* Capped as chrome, not content: this strip sits over every screen,
              and at 300% it would take the top third of each one. It still
              wraps rather than clips, and past the stack threshold the button
              drops below the text so the words keep the whole width. */}
          <Text style={styles.title} maxFontSizeMultiplier={FONT_CAP.chrome}>
            {status.title}
          </Text>
          <Text style={styles.body} maxFontSizeMultiplier={FONT_CAP.chrome}>
            {status.body}
          </Text>
        </View>
        <Pressable
          onPress={() => fix(status)}
          style={({ pressed }) => [styles.fixBtn, pressed && styles.fixBtnPressed]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Fix. ${status.title}.`}
        >
          <Text style={styles.fixText} maxFontSizeMultiplier={FONT_CAP.chrome}>Fix</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.faint,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    // Room for the rail on the left; the page margin on the right.
    paddingLeft: spacing.md + 4,
    paddingRight: spacing.md,
    paddingVertical: 10,
  },
  rowStacked: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  rail: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  copy: { flex: 1, alignSelf: "stretch", justifyContent: "center" },
  title: { fontSize: 13, lineHeight: 18, fontWeight: "800", color: colors.ink },
  body: { fontSize: 13, lineHeight: 18, color: colors.mute, marginTop: 1 },
  fixBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.red,
  },
  fixBtnPressed: { opacity: 0.85 },
  fixText: { color: "#fff", fontWeight: "800", fontSize: 13 },
});
