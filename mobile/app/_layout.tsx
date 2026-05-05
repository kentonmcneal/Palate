import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View, Text } from "react-native";
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
import * as WebBrowser from "expo-web-browser";
import { initObservability } from "../lib/observability";
import { registerPushToken } from "../lib/notifications";

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

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  const [fontsLoaded] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold,
    Inter_700Bold, Inter_800ExtraBold,
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
    void initObservability();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoaded(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      // Register push token whenever a session shows up.
      if (s?.user) void registerPushToken();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Route guard: kick to /sign-in if not authed; bounce away from /sign-in
  // once authed. Signed-in users are allowed to be in /onboarding so brand-new
  // accounts can finish setup before landing in the tabs.
  useEffect(() => {
    if (!loaded) return;
    const inAuthGroup = segments[0] === "sign-in" || segments[0] === "onboarding";
    if (!session && !inAuthGroup) {
      router.replace("/sign-in");
    } else if (session && segments[0] === "sign-in") {
      router.replace("/(tabs)");
    }
  }, [session, loaded, segments]);

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
