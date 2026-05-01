import Svg, { Rect, Path } from "react-native-svg";
import { View, Text, StyleSheet } from "react-native";
import { colors } from "../theme";

// Standardized sizes — keep usage to these values so the brand mark looks
// consistent across surfaces. Hero = onboarding/sign-in; In-app = tab headers.
export const LOGO_SIZE = {
  hero: 56,
  inApp: 32,
} as const;

export function Logo({ size = LOGO_SIZE.hero }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Rect width="64" height="64" rx="16" fill={colors.red} />
      <Path d="M22 18 V52" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" />
      <Path
        d="M22 22 a10 10 0 1 1 0 20 H22"
        stroke="#FFFFFF"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

// Wordmark scales the text alongside the icon so spacing stays consistent
// at any size.
export function Wordmark({ size = LOGO_SIZE.inApp }: { size?: number }) {
  const textSize = Math.round(size * 0.69);
  return (
    <View style={styles.row}>
      <Logo size={size} />
      <Text style={[styles.text, { fontSize: textSize }]}>palate</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  text: {
    fontWeight: "700",
    letterSpacing: -0.6,
    color: colors.ink,
  },
});
