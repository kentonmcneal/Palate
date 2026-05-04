import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { colors, type } from "../../theme";

export type DonutSlice = {
  label: string;
  value: number;
  color: string;
};

type Props = {
  data: DonutSlice[];
  /** Outer diameter, px. */
  size?: number;
  /** Stroke thickness in px. */
  thickness?: number;
  /** Big number rendered in the center (e.g. "42 visits"). */
  centerValue?: string;
  centerLabel?: string;
  /** Index of slice to highlight (other slices dim). null = all equal. */
  focusedIndex?: number | null;
};

/**
 * Donut/ring chart. Renders one stroked arc per slice, drawn around the
 * circumference using stroke-dasharray + stroke-dashoffset. Pure SVG, no
 * extra deps. Fine for up to ~12 slices.
 */
export function DonutChart({
  data,
  size = 220,
  thickness = 22,
  centerValue,
  centerLabel,
  focusedIndex = null,
}: Props) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  let offset = 0;

  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size}>
        {/* Background ring */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.line}
          strokeWidth={thickness}
          fill="none"
          opacity={0.4}
        />
        {/* Slice arcs — rotated -90 so they start at 12 o'clock */}
        <G rotation={-90} originX={size / 2} originY={size / 2}>
          {data.map((slice, i) => {
            const len = (slice.value / total) * circumference;
            const dim = focusedIndex != null && focusedIndex !== i;
            const node = (
              <Circle
                key={slice.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={slice.color}
                strokeWidth={focusedIndex === i ? thickness + 4 : thickness}
                strokeLinecap="butt"
                fill="none"
                strokeDasharray={`${len} ${circumference - len}`}
                strokeDashoffset={-offset}
                opacity={dim ? 0.25 : 1}
              />
            );
            offset += len;
            return node;
          })}
        </G>
      </Svg>
      {(centerValue || centerLabel) && (
        <View style={[styles.center, { width: size, height: size }]} pointerEvents="none">
          {centerValue && <Text style={styles.centerValue}>{centerValue}</Text>}
          {centerLabel && <Text style={styles.centerLabel}>{centerLabel}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", alignItems: "center", justifyContent: "center" },
  center: { position: "absolute", alignItems: "center", justifyContent: "center" },
  centerValue: { fontSize: 28, fontWeight: "800", color: colors.ink, letterSpacing: -1 },
  centerLabel: { ...type.micro, marginTop: 2 },
});
