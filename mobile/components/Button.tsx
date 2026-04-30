import { Pressable, Text, StyleSheet, ActivityIndicator, View } from "react-native";
import { colors, radius } from "../theme";

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
  const style = [
    styles.base,
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
        <Text style={textStyle}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  primary: { backgroundColor: colors.red },
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
