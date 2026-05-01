import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { colors } from "../theme";
import { initObservability } from "../lib/observability";

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    void initObservability();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoaded(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
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

  if (!loaded) {
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
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
