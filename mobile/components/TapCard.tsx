import { useRef } from "react";
import { Animated, Pressable, type PressableProps, type ViewStyle } from "react-native";

// ============================================================================
// TapCard — Pressable wrapper that scales to 0.97 on press for tactile feel.
// Drop-in replacement for any Pressable/TouchableOpacity that wraps a card.
// ============================================================================

type Props = Omit<PressableProps, "style" | "children"> & {
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
};

export function TapCard({ style, children, onPressIn, onPressOut, ...rest }: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  function handlePressIn(e: any) {
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
    onPressIn?.(e);
  }
  function handlePressOut(e: any) {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
    onPressOut?.(e);
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        {...rest}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={style}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
