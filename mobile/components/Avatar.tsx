import { View, Text, Image, StyleSheet } from "react-native";
import { colors } from "../theme";

type Props = {
  uri?: string | null;
  name?: string | null;
  email?: string | null;
  size?: number;
};

export function Avatar({ uri, name, email, size = 48 }: Props) {
  const radius = size / 2;
  const fontSize = Math.max(12, size * 0.4);
  const initial = pickInitial(name, email);

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.image, { width: size, height: size, borderRadius: radius }]}
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: radius }]}>
      <Text style={[styles.fallbackText, { fontSize }]}>{initial}</Text>
    </View>
  );
}

function pickInitial(name?: string | null, email?: string | null): string {
  const s = (name?.trim() || email?.trim() || "?").trim();
  return s ? s[0].toUpperCase() : "?";
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.faint },
  fallback: {
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackText: {
    color: "#fff",
    fontWeight: "800",
  },
});
