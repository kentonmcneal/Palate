import { View, Text, StyleSheet } from "react-native";
import { colors } from "../../theme";

type Props = {
  /** 24-element array, hourlyCounts[0..23] */
  data: number[];
  height?: number;
};

// Axis labels at 6am / 12pm / 6pm / 12am for a clean 4-tick reference.
const AXIS_TICKS = [
  { hour: 0, label: "12a" },
  { hour: 6, label: "6a" },
  { hour: 12, label: "12p" },
  { hour: 18, label: "6p" },
];

/**
 * 24-bin histogram of visit counts by hour-of-day. Visually scans like a
 * day timeline so users can see "when do I actually eat?" at a glance.
 * Peak hour is accented red.
 */
export function HourlyHistogram({ data, height = 130 }: Props) {
  if (data.length !== 24) return null;
  const max = Math.max(...data, 1);
  const peakIndex = data.reduce((best, cur, i, arr) => (cur > arr[best] ? i : best), 0);
  const hasAny = data.some((v) => v > 0);

  return (
    <View>
      <View style={[styles.bars, { height }]}>
        {data.map((value, i) => {
          const h = (value / max) * (height - 14);
          return (
            <View key={i} style={styles.col}>
              <View
                style={[
                  styles.bar,
                  {
                    height: Math.max(2, h),
                    backgroundColor:
                      value === 0
                        ? colors.line
                        : i === peakIndex && hasAny
                          ? colors.red
                          : colors.ink,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
      <View style={styles.axis}>
        {AXIS_TICKS.map((t) => (
          <View
            key={t.hour}
            style={[styles.tick, { left: `${(t.hour / 24) * 100}%` }]}
          >
            <Text style={styles.tickLabel}>{t.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bars: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
  },
  col: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" },
  bar: { width: "100%", borderRadius: 2 },
  axis: { position: "relative", height: 18, marginTop: 6 },
  tick: { position: "absolute", transform: [{ translateX: -10 }] },
  tickLabel: { fontSize: 10, color: colors.mute, fontWeight: "600" },
});
