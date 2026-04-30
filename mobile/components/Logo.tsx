import Svg, { Rect, Path } from "react-native-svg";
import { View, Text, StyleSheet } from "react-native";
import { colors } from "../theme";

export function Logo({ size = 40 }: { size?: number }) {
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

export function Wordmark() {
  return (
    <View style={styles.row}>
      <Logo size={32} />
      <Text style={styles.text}>palate</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  text: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.6,
    color: colors.ink,
  },
});
