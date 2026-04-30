import { Tabs } from "expo-router";
import { Text, View } from "react-native";
import { colors } from "../../theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.red,
        tabBarInactiveTintColor: colors.mute,
        tabBarStyle: { borderTopColor: colors.line, height: 84, paddingTop: 8 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
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
        name="add"
        options={{
          title: "Add",
          tabBarIcon: ({ color }) => <TabIcon glyph="+" color={color} bold />,
        }}
      />
      <Tabs.Screen
        name="wrapped"
        options={{
          title: "Wrapped",
          tabBarIcon: ({ color }) => <TabIcon glyph="✦" color={color} />,
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
          tabBarIcon: ({ color }) => <TabIcon glyph="◐" color={color} />,
        }}
      />
      {/* Try List moved into Profile tab as a section; route still exists for direct nav */}
      <Tabs.Screen
        name="wishlist"
        options={{
          href: null, // hide from tab bar
        }}
      />
    </Tabs>
  );
}

function TabIcon({ glyph, color, bold }: { glyph: string; color: string; bold?: boolean }) {
  return (
    <View style={{ height: 24, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color, fontSize: bold ? 28 : 22, fontWeight: bold ? "800" : "600" }}>
        {glyph}
      </Text>
    </View>
  );
}
