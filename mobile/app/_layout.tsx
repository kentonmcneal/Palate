import { Stack, useRouter, useSegments, type ErrorBoundaryProps } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, View, Text, Pressable } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  useFonts,
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
  Inter_700Bold, Inter_800ExtraBold,
} from "@expo-google-fonts/inter";
import {
  Fraunces_600SemiBold, Fraunces_700Bold,
} from "@expo-google-fonts/fraunces";
import { supabase } from "../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { colors } from "../theme";
import * as WebBrowser from "expo-web-browser";
import { initObservability, captureError } from "../lib/observability";
import { registerPushToken } from "../lib/notifications";
import { checkForAutoVisitOnForeground } from "../lib/auto-detect";
import { installGlobalErrorHandlers } from "../lib/global-error-handler";
import { isApproved } from "../lib/waitlist";

// Install app-wide catch-alls for uncaught errors / unhandled rejections BEFORE
// any app code runs. Under the New Architecture an unhandled rejection would
// otherwise become a native fatal that expo-updates escalates to a SIGABRT
// (the brand-new-account launch crash). Runs at module load — earliest point
// we control in an expo-router app.
installGlobalErrorHandlers();

// Resolve any pending OAuth session (Gmail Connect) when the app is reopened
// after the system browser hand-off.
WebBrowser.maybeCompleteAuthSession();

// Map RN font weights to the loaded Inter variants. Set once, applied app-wide
// via Text.defaultProps below.
function fontFamilyForWeight(w: string | number | undefined): string {
  const n = typeof w === "string" ? parseInt(w, 10) : w ?? 400;
  if (n >= 800) return "Inter_800ExtraBold";
  if (n >= 700) return "Inter_700Bold";
  if (n >= 600) return "Inter_600SemiBold";
  if (n >= 500) return "Inter_500Medium";
  return "Inter_400Regular";
}

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
      {__DEV__ && (
        <Text style={{ marginTop: 16, fontSize: 11, color: colors.mute, textAlign: "center" }}>
          {error?.message}
        </Text>
      )}
    </View>
  );
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  const [approved, setApproved] = useState<boolean | null>(null);

  const [fontsLoaded] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
    Inter_700Bold, Inter_800ExtraBold,
    Fraunces_600SemiBold, Fraunces_700Bold,
  });

  // Once fonts load, default every Text to Inter regular. Heavier weights are
  // applied via theme.ts (per-weight Inter family); inline `fontWeight`
  // styles RN can synth-bold from regular which is acceptable as a fallback.
  useEffect(() => {
    if (!fontsLoaded) return;
    (Text as any).defaultProps = (Text as any).defaultProps || {};
    (Text as any).defaultProps.style = [
      { fontFamily: fontFamilyForWeight(undefined) },
      (Text as any).defaultProps.style,
    ];
  }, [fontsLoaded]);

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

  // Waitlist gate: resolve the signed-in user's approval status. Fails OPEN
  // (approved) on any error so a network blip — or shipping this ahead of the
  // migration — never strands a real user on the waitlist.
  useEffect(() => {
    if (!session?.user) {
      setApproved(null);
      return;
    }
    let active = true;
    isApproved()
      .then((a) => { if (active) setApproved(a); })
      .catch((e) => {
        void captureError(e, { at: "approvalCheck" });
        if (active) setApproved(true);
      });
    return () => { active = false; };
  }, [session?.user]);

  // Auto-detect: every time the app comes to foreground (or first launches
  // while already authed), check if the user appears to be at a restaurant.
  // The helper itself respects the toggle, throttle, and permission state.
  useEffect(() => {
    if (!session?.user) return;
    void checkForAutoVisitOnForeground().catch((e) => captureError(e, { at: "autoVisit:mount" }));
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void checkForAutoVisitOnForeground().catch((e) => captureError(e, { at: "autoVisit:foreground" }));
    });
    return () => sub.remove();
  }, [session?.user]);

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
      // Hold routing until approval is known, then gate: pending users are
      // pinned to /waitlist; approved users never sit on sign-in/waitlist.
      if (approved === null) return;
      if (!approved) {
        if (seg0 !== "waitlist") router.replace("/waitlist");
        return;
      }
      if (seg0 === "sign-in" || seg0 === "waitlist") router.replace("/(tabs)");
    }
  }, [session, loaded, approved, segments]);

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
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="confirm-visit" options={{ presentation: "modal" }} />
          <Stack.Screen name="year-in-review" options={{ presentation: "modal" }} />
          <Stack.Screen name="insights" options={{ presentation: "modal" }} />
          <Stack.Screen name="friends" options={{ presentation: "modal" }} />
          <Stack.Screen name="profile/[id]" options={{ presentation: "modal" }} />
          <Stack.Screen name="visit/[id]" options={{ presentation: "modal" }} />
          <Stack.Screen name="all-visits" options={{ presentation: "modal" }} />
          <Stack.Screen name="restaurant/[place_id]" options={{ presentation: "modal" }} />
          <Stack.Screen name="photos" options={{ presentation: "modal" }} />
          <Stack.Screen name="demographics" options={{ presentation: "modal" }} />
          <Stack.Screen name="map" options={{ presentation: "modal" }} />
          <Stack.Screen name="insights-deep" options={{ presentation: "modal" }} />
          <Stack.Screen name="rate-items" options={{ presentation: "modal" }} />
          <Stack.Screen name="featured-list/[slug]" options={{ presentation: "modal" }} />
          <Stack.Screen name="location-picker" options={{ presentation: "modal" }} />
          <Stack.Screen name="wrapped-story" options={{ presentation: "modal" }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
