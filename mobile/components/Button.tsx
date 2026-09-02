import { Pressable, Text, StyleSheet, ActivityIndicator, View } from "react-native";
import { colors, radius } from "../theme";
import { FONT_CAP, useFontScale, scaleSpace } from "../lib/a11y";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  title,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { scale } = useFontScale();

  const style = [
    styles.base,
    // Grow the control with its label. A fixed 52pt box clipped the text
    // outright at large accessibility sizes.
    { minHeight: scaleSpace(52, scale) },
    variant === "primary" && styles.primary,
    variant === "secondary" && styles.secondary,
    variant === "ghost" && styles.ghost,
    variant === "danger" && styles.danger,
    (loading || disabled) && styles.disabled,
  ];

  const textStyle = [
    styles.text,
    variant === "primary" && styles.textOnRed,
    variant === "secondary" && styles.textOnInk,
    variant === "ghost" && styles.textOnGhost,
    variant === "danger" && styles.textOnDanger,
  ];

  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      style={({ pressed }) => [...style, pressed && { opacity: 0.85 }]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? "#fff" : colors.ink} />
      ) : (
        <Text style={textStyle} maxFontSizeMultiplier={FONT_CAP.chrome}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    // minHeight, not height — see the Pressable above. Kept here as the floor.
    minHeight: 52,
    paddingVertical: 12,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.ink },
  ghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.line },
  danger: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.red },
  disabled: { opacity: 0.5 },
  text: { fontSize: 16, fontWeight: "600" },
  textOnRed: { color: "#FFFFFF" },
  textOnInk: { color: "#FFFFFF" },
  textOnGhost: { color: colors.ink },
  textOnDanger: { color: colors.red },
});

export function Spacer({ size = 16 }: { size?: number }) {
  return <View style={{ height: size }} />;
}
