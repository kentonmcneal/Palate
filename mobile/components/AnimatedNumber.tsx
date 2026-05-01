import { useEffect, useRef, useState } from "react";
import { Text, type TextProps, type TextStyle, Animated, Easing } from "react-native";

// ============================================================================
// AnimatedNumber — ticks from 0 (or `from`) up to `value` over `duration` ms.
// Resets and re-animates when `value` changes. Used for match scores,
// percentiles, visit counts — any number that should feel earned.
// ============================================================================

type Props = Omit<TextProps, "children"> & {
  value: number;
  from?: number;
  duration?: number;
  /** Append this string after the number (e.g. "%"). Static, not animated. */
  suffix?: string;
  /** Format the displayed number — default Math.round. */
  format?: (n: number) => string;
  style?: TextStyle | TextStyle[];
};

export function AnimatedNumber({
  value, from = 0, duration = 700, suffix = "", format, style, ...rest
}: Props) {
  const anim = useRef(new Animated.Value(from)).current;
  const [display, setDisplay] = useState(from);

  useEffect(() => {
    anim.setValue(from);
    const sub = anim.addListener(({ value: v }) => setDisplay(v));
    Animated.timing(anim, {
      toValue: value,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // we read the value
    }).start();
    return () => { anim.removeListener(sub); };
  }, [value, duration, from, anim]);

  const text = (format ? format(display) : String(Math.round(display))) + suffix;
  return <Text style={style} {...rest}>{text}</Text>;
}
