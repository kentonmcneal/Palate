import { View, Text, StyleSheet } from "react-native";
import { colors, type } from "../../theme";

export type BarRow = {
  label: string;
  value: number;
  /** Optional explicit color; defaults to brand red gradient by index. */
  color?: string;
  /** Right-aligned suffix, e.g. "12 (28%)". */
  suffix?: string;
};

type Props = {
  data: BarRow[];
  /** Max value to scale to. Defaults to data max. */
  max?: number;
};

const PALETTE = [
  "#FF3008", // red
  "#FF6B45",
  "#FF9466",
  "#FFB68C",
  "#222222",
  "#555555",
  "#888888",
];

/** Horizontal bar chart for category breakdowns (e.g. format mix). */
export function HorizontalBars({ data, max }: Props) {
  if (data.length === 0) return null;
  const m = max ?? Math.max(...data.map((d) => d.value), 1);

  return (
    <View>
      {data.map((row, i) => {
        const pct = (row.value / m) * 100;
        const color = row.color ?? PALETTE[i % PALETTE.length];
        return (
          <View key={row.label} style={styles.row}>
            <View style={styles.head}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.suffix}>{row.suffix ?? row.value}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: 14 },
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink },
  suffix: { ...type.small, color: colors.mute, fontWeight: "600" },
  track: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.faint,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 999 },
});
