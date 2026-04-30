import { View, Text, StyleSheet } from "react-native";
import { colors } from "../../theme";

export type VBar = {
  label: string;
  value: number;
};

type Props = {
  data: VBar[];
  height?: number;
  accentIndex?: number; // which bar to draw in red
};

/** Vertical bar chart for time-of-day / day-of-week distributions. */
export function VerticalBars({ data, height = 160, accentIndex = -1 }: Props) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <View style={[styles.wrap, { height }]}>
      {data.map((bar, i) => {
        const h = (bar.value / max) * (height - 38);
        return (
          <View key={bar.label} style={styles.col}>
            <Text style={styles.value}>{bar.value > 0 ? bar.value : ""}</Text>
            <View
              style={[
                styles.bar,
                {
                  height: Math.max(2, h),
                  backgroundColor: i === accentIndex ? colors.red : colors.ink,
                },
              ]}
            />
            <Text style={styles.label}>{bar.label}</Text>
          </View>
        );
      })}
    </View>
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
