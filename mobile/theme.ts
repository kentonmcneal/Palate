// Palate brand tokens — single source of truth for colors + spacing.

export const colors = {
  red: "#FF3008",
  ink: "#111111",
  paper: "#FFFFFF",
  mute: "#6B6B6B",
  line: "#EAEAEA",
  inkDim: "#2A2A2A",
  faint: "#F6F6F6",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  full: 999,
};

// Font families come from @expo-google-fonts/inter — loaded in app/_layout.tsx.
// Mapped per weight because RN doesn't synth Inter weights well.
export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  heavy: "Inter_800ExtraBold",
};

export const type = {
  display: { fontFamily: fonts.heavy, fontSize: 36, letterSpacing: -1.2 },
  title: { fontFamily: fonts.bold, fontSize: 24, letterSpacing: -0.6 },
  subtitle: { fontFamily: fonts.semibold, fontSize: 18, letterSpacing: -0.3 },
  body: { fontFamily: fonts.regular, fontSize: 16 },
  small: { fontFamily: fonts.regular, fontSize: 14, color: colors.mute },
  micro: { fontFamily: fonts.medium, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" as const, color: colors.mute },
};
