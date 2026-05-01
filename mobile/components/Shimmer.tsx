import { useEffect, useRef } from "react";
import { Animated, Easing, View, type ViewStyle, StyleSheet } from "react-native";
import { colors } from "../theme";

// ============================================================================
// Shimmer — gray rectangle that pulses opacity. Use as skeleton placeholders
// while content loads. Composable: stack with View / margins as needed.
// ============================================================================

type Props = {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
};

export function Shimmer({ width = "100%", height = 16, borderRadius = 8, style }: Props) {
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[
        styles.base,
        { width: width as any, height, borderRadius, opacity },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.faint },
});

// Pre-baked skeletons for common shapes
export function CardSkeleton() {
  return (
    <View style={skeletonStyles.cardWrap}>
      <Shimmer height={20} width="60%" />
      <View style={{ height: 8 }} />
      <Shimmer height={14} width="80%" />
      <View style={{ height: 10 }} />
      <Shimmer height={14} width="40%" />
    </View>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <View>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={skeletonStyles.row}>
          <Shimmer width={56} height={56} borderRadius={12} />
          <View style={{ flex: 1 }}>
            <Shimmer height={16} width="70%" />
            <View style={{ height: 6 }} />
            <Shimmer height={12} width="50%" />
          </View>
        </View>
      ))}
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  cardWrap: {
    padding: 16, borderRadius: 18,
    borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.paper,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.paper,
  },
});
