import { Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors } from "../../theme";
import { latestWrapped } from "../../lib/wrapped";
import { triggerHapticSelection } from "../../lib/haptics";

export const LAST_SEEN_WRAPPED_KEY = "palate.wrapped.lastSeen";

export default function TabsLayout() {
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
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.red,
        tabBarInactiveTintColor: colors.mute,
        tabBarStyle: { borderTopColor: colors.line, height: 84, paddingTop: 8 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
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
        name="feed"
        options={{
          title: "Feed",
          tabBarIcon: ({ color }) => <TabIcon glyph="◉" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Profile",
          // Wrapped now lives on Profile — surface its "new this week" dot here
          // so users still get a glanceable nudge to open it on Sundays.
          tabBarIcon: ({ color }) => <TabIcon glyph="◐" color={color} dot={wrappedHasNew} />,
        }}
      />
      {/* Hidden from tab bar but routes still exist for direct navigation */}
      <Tabs.Screen name="wrapped" options={{ href: null }} />
      <Tabs.Screen name="add" options={{ href: null }} />
      <Tabs.Screen name="wishlist" options={{ href: null }} />
    </Tabs>
  );
}

function TabIcon({
  glyph, color, bold, dot,
}: { glyph: string; color: string; bold?: boolean; dot?: boolean }) {
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
