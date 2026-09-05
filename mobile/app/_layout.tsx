import { Stack, useRouter, useSegments, type ErrorBoundaryProps } from "expo-router";
import * as ScreenCapture from "expo-screen-capture";
import {
  registerConfirmCategory,
  confirmVisitById,
  declineVisitById,
  drainConfirmQueue,
} from "../lib/passive-confirm";
import { refreshDiscoveryPings } from "../lib/notification-schedule";
import { recordHeartbeat } from "../lib/heartbeat";
import { ScreenshotFeedbackSheet } from "../components/ScreenshotFeedbackSheet";
import {
  shouldPromptNow,
  recordPromptShown,
  recordPromptDismissed,
} from "../lib/screenshot-feedback";
import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, View, Pressable } from "react-native";
import { Text } from "../components/Text";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  useFonts,
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
  Inter_700Bold, Inter_800ExtraBold,
} from "@expo-google-fonts/inter";
import { supabase } from "../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { colors } from "../theme";
import { getMyProfile } from "../lib/profile";
import { subscribeUsernameClaimed, isUsernameClaimed } from "../lib/username-gate";
import { needsNotificationPrimer, isPrimerSeen, subscribePrimerSeen } from "../lib/notification-primer";
import * as WebBrowser from "expo-web-browser";
import { initObservability, captureError } from "../lib/observability";
import { registerPushToken } from "../lib/notifications";
import { track } from "../lib/analytics";
import { checkForAutoVisitOnForeground } from "../lib/auto-detect";
import { installGlobalErrorHandlers } from "../lib/global-error-handler";
import * as Notifications from "expo-notifications";
import { processPendingVisits } from "../lib/passive-runner";
import {
  resumePassiveCaptureIfOptedIn, isPassiveOptedIn, reportDay7PermissionState,
} from "../lib/passive-capture";
import { addVisitListener } from "../modules/palate-visit-monitor";
import {
  checkPermissionDowngrade, hasAlways, needsAlwaysPrompt, dismissAlwaysPrompt,
} from "../lib/passive-permissions";
import { PermissionRepairBanner } from "../components/PermissionRepairBanner";

// Install app-wide catch-alls for uncaught errors / unhandled rejections BEFORE
// any app code runs. Under the New Architecture an unhandled rejection would
// otherwise become a native fatal that expo-updates escalates to a SIGABRT
// (the brand-new-account launch crash). Runs at module load — earliest point
// we control in an expo-router app.
installGlobalErrorHandlers();

// Present notifications while the app is foregrounded — otherwise a confirm
// prompt scheduled during a foreground pipeline run is silently not shown.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Resolve any pending OAuth session (Gmail Connect) when the app is reopened
// after the system browser hand-off.
WebBrowser.maybeCompleteAuthSession();

// Root error boundary. expo-router renders this instead of letting a render-time
// exception propagate to a native fatal — which, with expo-updates' error
// recovery, was aborting the whole app (SIGABRT on expo.controller.errorRecoveryQueue).
// A single bad screen now degrades to a recoverable in-app fallback.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  // Report the caught render error to Sentry so we see the real message even on
  // release builds (where __DEV__ is false). This turns the boundary into a
  // diagnostic: if the new-account crash is a catchable render throw, it now
  // surfaces here by name instead of us inferring it.
  useEffect(() => {
    void captureError(error, { boundary: "root" });
  }, [error]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 18, fontWeight: "800", color: colors.ink, marginBottom: 8 }}>
        Something went wrong
      </Text>
      <Text style={{ fontSize: 14, color: colors.mute, textAlign: "center", marginBottom: 20, lineHeight: 20 }}>
        The app hit an unexpected error. Tap to try again — your data is safe.
      </Text>
      <Pressable
        onPress={retry}
        style={{ backgroundColor: colors.red, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12 }}
        accessibilityRole="button"
      >
        <Text style={{ color: "#fff", fontWeight: "800" }}>Reload</Text>
      </Pressable>
      {/* Shown in release too. This is a beta with fourteen people on it,
          and "the app hit an unexpected error" with no message is a screenshot
          nobody can act on. The text is the exception message, never a stack. */}
      <Text style={{ marginTop: 16, fontSize: 11, color: colors.mute, textAlign: "center" }} selectable>
        {String(error?.message ?? error ?? "").slice(0, 300)}
      </Text>
    </View>
  );
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  const [repairVisible, setRepairVisible] = useState(false);

  const [fontsLoaded] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
    Inter_700Bold, Inter_800ExtraBold,
  });

  // Inter for every Text is handled by components/Text, which every screen
  // imports instead of react-native's. This used to set Text.defaultProps
  // here; React 19 dropped defaultProps on function components and RN's Text
  // is one, so that had been a no-op since the upgrade and most of the app
  // was quietly rendering in San Francisco.

  useEffect(() => {
    // These startup tasks are fire-and-forget, so EVERY one must have its own
    // rejection handler. Under the New Architecture an unhandled promise
    // rejection becomes a native fatal, which expo-updates' error recovery then
    // escalates to a SIGABRT (it looks for an update to roll back to, finds
    // none, and re-raises). That was the brand-new-account launch crash: a
    // first-run task (push permission / token) rejected with nothing to catch
    // it. A React ErrorBoundary sits above this layer and cannot help here.
    void initObservability().catch((e) => captureError(e, { at: "initObservability" }));
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        setLoaded(true);
      })
      .catch((e) => {
        // Never let a failed session restore hang the splash or escape unhandled.
        setLoaded(true);
        void captureError(e, { at: "getSession" });
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      // Register push token whenever a session shows up — the first-run path
      // (permission prompt + token fetch) is the one that crashed new accounts.
      if (s?.user) void registerPushToken().catch((e) => captureError(e, { at: "registerPushToken" }));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // The weekly discovery pings (Friday date night, Saturday brunch, Thursday
  // stretch) were only ever registered with iOS when somebody toggled the
  // switch in Settings. The switch defaults to ON, so it read as enabled while
  // nothing had ever been scheduled — nobody was getting a Friday nudge, and
  // the settings screen said they were.
  //
  // refreshDiscoveryPings cancels before it schedules, so running it on every
  // authed launch is idempotent, and it re-arms after an OS notification reset.
  // Guarded: an unhandled rejection in a fire-and-forget startup task is what
  // made new accounts crash on launch once (build 13).
  useEffect(() => {
    if (!session?.user) return;
    void refreshDiscoveryPings().catch((e) => captureError(e, { at: "refreshDiscoveryPings" }));
  }, [session]);

  // Auto-detect: every time the app comes to foreground (or first launches
  // while already authed), check if the user appears to be at a restaurant.
  // The helper itself respects the toggle, throttle, and permission state.
  useEffect(() => {
    if (!session?.user) return;
    const onForeground = () => {
      void checkForAutoVisitOnForeground().catch((e) => captureError(e, { at: "autoVisit:foreground" }));
      // Passive capture (Phases 3–4): drain + qualify + resolve + confirm any
      // visits captured while backgrounded. Gated internally by the kill switch.
      void processPendingVisits().catch((e) => captureError(e, { at: "passive:process" }));
      // Re-arm monitoring for a user who opted in — covers a reinstall, a
      // permission re-granted in iOS Settings, or a kill switch flipped on
      // after they opted in. Never prompts; no-ops for everyone else.
      void resumePassiveCaptureIfOptedIn().catch((e) => captureError(e, { at: "passive:resume" }));
      // Fires once, a week after opt-in. This is the honest read of the
      // location-grant metric: onboarding reports ~100% under provisional
      // Always, because iOS asks the user days later without telling us.
      void reportDay7PermissionState(hasAlways, (granted, days) => {
        void track("perm_always_day7", { granted, days_since_opt_in: days });
      }).catch((e) => captureError(e, { at: "passive:day7" }));
      // Detect a silent Always downgrade and surface the repair banner — but
      // only nag someone who actually opted in. Anyone else revoking location
      // is doing exactly what they meant to.
      void checkPermissionDowngrade()
        .then(async (downgraded) => {
          if (!(await isPassiveOptedIn())) return;
          // A downgrade always surfaces. So does never having granted Always at
          // all — onboarding used to tell people to pick "While Using the App",
          // so an opted-in account could sit for weeks with a tracking toggle
          // reading ON, capturing nothing, and nothing explaining why. That
          // second case is rate-limited to once a week.
          if (downgraded || (await needsAlwaysPrompt())) setRepairVisible(true);
        })
        .catch((e) => captureError(e, { at: "passive:downgrade" }));
    };
    onForeground();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") onForeground();
    });
    return () => sub.remove();
  }, [session?.user]);

  // Process a visit the moment the native layer captures one, rather than
  // waiting for the next foreground. iOS wakes us for a location event without
  // making the app "active", so the AppState listener above never fires on a
  // background delivery — the detection would sit on disk until the user
  // happened to open Palate, which defeats the whole point. processPendingVisits
  // has its own in-flight guard, so overlapping with the foreground run is safe.
  useEffect(() => {
    if (!session?.user) return;
    const sub = addVisitListener(() => {
      void processPendingVisits().catch((e) => captureError(e, { at: "passive:onVisitEvent" }));
    });
    return () => sub?.remove();
  }, [session?.user]);

  // Register the Yes/No lock-screen actions, and replay any action whose write
  // failed while the app was backgrounded.
  useEffect(() => {
    void registerConfirmCategory();
  }, []);
  // Reconcile the weekly discovery nudges on every launch. Idempotent: it
  // cancels what it previously scheduled before re-adding.
  // Keyed on the id, not the user object: the object changes identity on
  // INITIAL_SESSION, SIGNED_IN and TOKEN_REFRESHED, which ran this three
  // times per launch and is how six brunch pings ended up on one lock screen.
  useEffect(() => {
    if (!session?.user) return;
    void refreshDiscoveryPings().catch(() => {});
  }, [session?.user?.id]);
  useEffect(() => {
    if (!session?.user) return;
    void recordHeartbeat(true).catch(() => {});
    void drainConfirmQueue().catch(() => {});
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") {
        void recordHeartbeat().catch(() => {});
        void drainConfirmQueue().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [session?.user]);

  // Handle a passive-capture confirmation notification. Three outcomes:
  //   confirm_yes / confirm_no — answered from the lock screen, app stays shut
  //   plain tap                — open /confirm-visit as before
  // Covers live responses and a cold-start tap (app was terminated).
  useEffect(() => {
    const handle = (response: Notifications.NotificationResponse | null | undefined) => {
      const data = response?.notification.request.content.data as Record<string, unknown> | undefined;

      // Activity push (migration 0057). Each one opens the thing it is about;
      // a notification that dumps you on Home teaches people to ignore them.
      if (data?.type === "user_joined") {
        router.push(`/profile/${String(data.user_id ?? "")}` as never);
        return;
      }
      if (data?.type === "user_wrapped") {
        router.push(`/profile/${String(data.user_id ?? "")}` as never);
        return;
      }
      if (data?.type === "friend_visit") {
        router.push(`/profile/${String(data.user_id ?? "")}` as never);
        return;
      }

      // Weekly discovery nudge — deep-link straight to what it promised.
      if (data?.type === "discovery_ping") {
        const { type: _t, key: _k, pathname, ...rest } = data as Record<string, string>;
        router.push({
          pathname: (pathname as string) || "/(tabs)/discover",
          params: rest,
        } as never);
        return;
      }

      if (data?.kind === "passive_digest") {
        router.push("/digest" as never);
        return;
      }
      if (data?.kind !== "passive_confirm") return;

      const placeId = String(data.place_id ?? "");
      const name = String(data.name ?? "");
      const inboxId = String(data.inbox_id ?? "") || undefined;

      // An action button answers in place — no navigation, no foregrounding.
      // The write path is headless for exactly this reason (see
      // lib/passive-confirm.ts).
      if (response?.actionIdentifier === "confirm_yes") {
        void confirmVisitById({ placeId, name, inboxId });
        return;
      }
      if (response?.actionIdentifier === "confirm_no") {
        void declineVisitById({ placeId, name, inboxId });
        return;
      }

      const common = {
        place_id: placeId,
        name,
        address: String(data.address ?? ""),
        alternates: String(data.alternates ?? "[]"),
        inbox_id: String(data.inbox_id ?? ""),
        dwell_min: String(data.dwell_min ?? ""),
        accuracy_m: String(data.accuracy_m ?? ""),
        detect_source: String(data.detect_source ?? ""),
        candidate_count: String(data.candidate_count ?? ""),
      };

      // A cluster of venues is one decision with several answers.
      if (data.multi === "1") {
        router.push({ pathname: "/confirm-multi", params: common });
        return;
      }

      router.push({
        pathname: "/confirm-visit",
        params: {
          place_id: placeId,
          name,
          address: String(data.address ?? ""),
          alternates: String(data.alternates ?? "[]"),
          confidence: "high",
          inbox_id: String(data.inbox_id ?? ""),
        },
      });
    };
    // Cold-start: the response that launched the app fires before this mounts.
    void Notifications.getLastNotificationResponseAsync()
      .then(handle)
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, [router]);

  // A screenshot is the cheapest signal we get that something on screen was
  // worth capturing. Offer the feedback form — throttled hard, because most
  // screenshots are users sharing a restaurant, not reporting a bug.
  const [screenshotPrompt, setScreenshotPrompt] = useState(false);
  useEffect(() => {
    if (!session) return; // feedback requires an account
    let sub: { remove: () => void } | null = null;
    try {
      sub = ScreenCapture.addScreenshotListener(() => {
        void shouldPromptNow().then((ok) => {
          if (!ok) return;
          void recordPromptShown();
          setScreenshotPrompt(true);
        });
      });
    } catch {
      // Listener is iOS/Android-native; never let its absence break launch.
    }
    return () => sub?.remove();
  }, [session]);

  // Whether this account still needs a handle. Resolved once per session —
  // this must not become a lookup on every navigation. Defaults to false so a
  // failed read never traps somebody on the gate.
  const [needsUsername, setNeedsUsername] = useState(false);
  useEffect(() => {
    if (!session) { setNeedsUsername(false); return; }
    let alive = true;
    void getMyProfile()
      .then((p) => { if (alive && p) setNeedsUsername(!p.username); })
      .catch(() => {});
    return () => { alive = false; };
  }, [session]);

  // The claim screen flips this the moment a handle is saved. Without it the
  // lookup above — keyed on [session], which does not change when you save —
  // stayed true forever and the guard bounced you back onto the gate you had
  // just completed.
  useEffect(() => subscribeUsernameClaimed(() => setNeedsUsername(false)), []);

  // The notification ask, once, with an explanation in front of it. Resolved
  // per session like the username gate and cleared the same one-way way.
  const [needsPrimer, setNeedsPrimer] = useState(false);
  useEffect(() => {
    if (!session) { setNeedsPrimer(false); return; }
    let alive = true;
    void needsNotificationPrimer()
      .then((n) => { if (alive) setNeedsPrimer(n); })
      .catch(() => {});
    return () => { alive = false; };
  }, [session]);
  useEffect(() => subscribePrimerSeen(() => setNeedsPrimer(false)), []);

  // Route guard: kick to /sign-in if not authed; bounce away from /sign-in
  // once authed. Signed-in users are allowed to be in /onboarding so brand-new
  // accounts can finish setup before landing in the tabs.
  useEffect(() => {
    if (!loaded) return;
    const seg0 = segments[0];
    const inAuthGroup = seg0 === "sign-in" || seg0 === "onboarding";
    if (!session && !inAuthGroup) {
      router.replace("/sign-in");
      return;
    }
    if (session) {
      // The invite-only gate is GONE (migration 0061). New accounts are
      // approved on arrival, so nothing routes to /waitlist any more —
      // signing in takes you straight into the app.
      //
      // Anyone who somehow still lands on /waitlist is bounced out rather
      // than stranded, and the routing no longer waits on an approval lookup
      // before deciding where to send someone.
      if (seg0 === "sign-in" || seg0 === "waitlist") router.replace("/(tabs)");

      // A handle is required as of the signup change, but every account made
      // before it has none, and those people will never see the onboarding
      // step that asks. Since the profile stopped showing login emails, an
      // account with no handle and no display name is anonymous to its own
      // friends. Onboarding is exempt because it asks for one itself.
      if (needsUsername && !isUsernameClaimed()
          && seg0 !== "onboarding" && seg0 !== "claim-username") {
        router.replace("/claim-username");
        return;
      }

      // After the handle, before the tabs: say what the notifications are,
      // then ask. Only ever once per install (lib/notification-primer.ts).
      if (needsPrimer && !isPrimerSeen()
          && seg0 !== "onboarding" && seg0 !== "claim-username"
          && seg0 !== "notifications-intro" && seg0 !== "passive-capture-intro") {
        router.replace("/notifications-intro");
      }
    }
  }, [session, loaded, segments, needsUsername, needsPrimer]);

  if (!loaded || !fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper }}>
        <ActivityIndicator color={colors.red} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <PermissionRepairBanner
          visible={repairVisible}
          onDismiss={() => { setRepairVisible(false); void dismissAlwaysPrompt(); }}
        />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="onboarding" />
          {/* Gate, not a destination: no back, reached only by the guard. */}
          <Stack.Screen name="claim-username" options={{ gestureEnabled: false }} />
          <Stack.Screen name="notifications-intro" options={{ gestureEnabled: false }} />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="confirm-visit" options={{ presentation: "modal" }} />
          <Stack.Screen name="confirm-multi" options={{ presentation: "modal" }} />
          <Stack.Screen name="passive-capture-intro" options={{ presentation: "modal" }} />
          <Stack.Screen name="passive-inbox" options={{ presentation: "modal" }} />
          <Stack.Screen name="digest" options={{ presentation: "modal" }} />
          <Stack.Screen name="curate-profile" options={{ presentation: "modal" }} />
          <Stack.Screen name="year-in-review" options={{ presentation: "modal" }} />
          <Stack.Screen name="insights" options={{ presentation: "modal" }} />
          <Stack.Screen name="friends" options={{ presentation: "modal" }} />
          <Stack.Screen name="people" options={{ presentation: "modal" }} />
          <Stack.Screen name="rankings" options={{ presentation: "modal" }} />
          <Stack.Screen name="import-review" options={{ presentation: "modal" }} />
          <Stack.Screen name="group" options={{ presentation: "modal" }} />
          <Stack.Screen name="profile/[id]" options={{ presentation: "modal" }} />
          <Stack.Screen name="visit/[id]" options={{ presentation: "modal" }} />
          <Stack.Screen name="restaurant/[place_id]" options={{ presentation: "modal" }} />
          <Stack.Screen name="photos" options={{ presentation: "modal" }} />
          <Stack.Screen name="demographics" options={{ presentation: "modal" }} />
          <Stack.Screen name="map" options={{ presentation: "modal" }} />
          <Stack.Screen name="insights-deep" options={{ presentation: "modal" }} />
          <Stack.Screen name="rate-items" options={{ presentation: "modal" }} />
          <Stack.Screen name="featured-list/[slug]" options={{ presentation: "modal" }} />
          <Stack.Screen name="location-picker" options={{ presentation: "modal" }} />
          <Stack.Screen name="wrapped-story" options={{ presentation: "modal" }} />
          {/* Settings and profile editing are pushed from the Profile tab, not
              presented as modals — you go there to change things and come back,
              and a card that slides over the profile hides the thing you are
              editing. */}
          <Stack.Screen name="settings" />
          <Stack.Screen name="edit-profile" />
          <Stack.Screen name="import-email" options={{ presentation: "modal" }} />
        </Stack>
        <ScreenshotFeedbackSheet
          visible={screenshotPrompt}
          onSend={() => {
            setScreenshotPrompt(false);
            router.push({
              pathname: "/feedback",
              params: { from: "/" + segments.join("/") },
            });
          }}
          onDismiss={() => {
            setScreenshotPrompt(false);
            void recordPromptDismissed();
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
