import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme";

export type VBar = {
  label: string;
  value: number;
};

type Props = {
  data: VBar[];
  height?: number;
  accentIndex?: number;
};

/**
 * Vertical bar chart for time-of-day / day-of-week distributions.
 * Tap any bar to focus it (highlights, lifts the value label). Heights
 * animate in on mount so the chart feels alive on first render.
 */
export function VerticalBars({ data, height = 160, accentIndex = -1 }: Props) {
  const [focused, setFocused] = useState<number | null>(null);
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  const usableH = height - 38;

  return (
    <View style={[styles.wrap, { height }]}>
      {data.map((bar, i) => {
        const targetH = (bar.value / max) * usableH;
        const isFocused = focused === i;
        const isAccent = isFocused || (focused == null && i === accentIndex);
        return (
          <BarColumn
            key={bar.label}
            value={bar.value}
            label={bar.label}
            targetHeight={Math.max(2, targetH)}
            color={isAccent ? colors.red : colors.ink}
            focused={isFocused}
            onPress={() => setFocused((cur) => (cur === i ? null : i))}
          />
        );
      })}
    </View>
  );
}

function BarColumn({
  value, label, targetHeight, color, focused, onPress,
}: {
  value: number; label: string; targetHeight: number; color: string;
  focused: boolean; onPress: () => void;
}) {
  const h = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(h, {
      toValue: targetHeight,
      duration: 600,
      delay: 80,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [targetHeight]);

  return (
    <Pressable style={styles.col} onPress={onPress}>
      <Text style={[styles.value, focused && { color: colors.red }]}>
        {value > 0 ? value : ""}
      </Text>
      <Animated.View
        style={[
          styles.bar,
          {
            height: h,
            backgroundColor: color,
            transform: [{ scaleX: focused ? 1.08 : 1 }],
          },
        ]}
      />
      <Text style={[styles.label, focused && { color: colors.red }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  col: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" },
  value: { fontSize: 11, color: colors.mute, fontWeight: "700", marginBottom: 4 },
  bar: { width: "60%", maxWidth: 36, borderRadius: 8, marginBottom: 6 },
  label: {
    fontSize: 11,
    color: colors.mute,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
});
