// CollapsibleSection — a tappable section header that expands/collapses its
// body. Used on the Profile tab to tuck settings chrome (Account, Help, About,
// Your data, Wrapped) behind bars so the page reads calm instead of as one long
// scroll. Same title look as the old static `Section`, plus a +/− affordance.

import { useState } from "react";
import {
  View,
  Pressable,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import { Text } from "./Text";
import { spacing, colors, type as typeTokens } from "../theme";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={{ marginTop: spacing.xl }}>
      <Pressable
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setOpen((o) => !o);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingVertical: 6,
        }}
      >
        <Text style={typeTokens.micro}>{title}</Text>
        <Text style={{ color: colors.mute, fontSize: 16, fontWeight: "600" }}>
          {open ? "–" : "+"}
        </Text>
      </Pressable>
      {open && <View style={{ marginTop: 10 }}>{children}</View>}
    </View>
  );
}
