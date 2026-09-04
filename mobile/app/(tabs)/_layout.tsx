import { Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View, type ColorValue } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "../../theme";
import { latestWrapped } from "../../lib/wrapped";
import { triggerHapticSelection } from "../../lib/haptics";
import { PalateIntroModal } from "../../components/PalateIntroModal";
import { FONT_CAP, useFontScale, scaleSpace } from "../../lib/a11y";

export const LAST_SEEN_WRAPPED_KEY = "palate.wrapped.lastSeen";

export default function TabsLayout() {
  const { scale: fontScale } = useFontScale();
  const [wrappedHasNew, setWrappedHasNew] = useState(false);

  // Poll for fresh wrapped on mount + every minute. Light enough.
  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const [latest, lastSeen] = await Promise.all([
          latestWrapped(),
          AsyncStorage.getItem(LAST_SEEN_WRAPPED_KEY),
        ]);
        if (!alive) return;
        if (!latest) { setWrappedHasNew(false); return; }
        setWrappedHasNew(!lastSeen || lastSeen < latest.week_start);
      } catch {
        // ignore; tab badge degrades to "no badge"
      }
    }
    check();
    const interval = setInterval(check, 60_000);
    return () => { alive = false; clearInterval(interval); };
  }, []);

  return (
    <>
    <PalateIntroModal />
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.red,
        tabBarInactiveTintColor: colors.mute,
        // Five labels across a fixed-width bar — the tightest type budget in
        // the app, so the cap here is the strictest. The bar itself grows a
        // little rather than clipping, but it cannot grow without eating the
        // screen, hence the ceiling on both.
        tabBarStyle: {
          borderTopColor: colors.line,
          height: scaleSpace(84, fontScale, FONT_CAP.tabBar),
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarLabelPosition: "below-icon",
        tabBarAllowFontScaling: true,
      }}
      screenListeners={{
        tabPress: () => { void triggerHapticSelection(); },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <TabIcon glyph="•" color={color} />,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: "Discover",
          tabBarIcon: ({ color }) => <TabIcon glyph="◇" color={color} />,
        }}
      />
      <Tabs.Screen
        name="wrapped"
        options={{
          title: "Wrapped",
          tabBarIcon: ({ color }) => <TabIcon glyph="✦" color={color} dot={wrappedHasNew} />,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: "Feed",
          tabBarIcon: ({ color }) => <TabIcon glyph="◉" color={color} />,
        }}
      />
      {/* File is `me.tsx`, not `profile.tsx`: `app/profile/[id].tsx` already
          owns the `profile` segment at the root, and two nodes with the same
          name at the same level is the kind of routing ambiguity that resolves
          differently between dev and a release bundle. The tab is still
          labelled Profile. */}
      <Tabs.Screen
        name="me"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <TabIcon glyph="◐" color={color} />,
        }}
      />
      {/* Hidden from tab bar but routes still exist for direct navigation */}
      <Tabs.Screen name="add" options={{ href: null }} />
      <Tabs.Screen name="wishlist" options={{ href: null }} />
    </Tabs>
    </>
  );
}

function TabIcon({
  glyph, color, bold, dot,
}: { glyph: string; color: ColorValue; bold?: boolean; dot?: boolean }) {
  return (
    <View style={{ height: 24, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color, fontSize: bold ? 28 : 22, fontWeight: bold ? "800" : "600" }}>
        {glyph}
      </Text>
      {dot && (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: -8,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.red,
          }}
        />
      )}
    </View>
  );
}
