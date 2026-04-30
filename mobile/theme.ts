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

export const type = {
  display: { fontSize: 36, fontWeight: "800" as const, letterSpacing: -1.2 },
  title: { fontSize: 24, fontWeight: "700" as const, letterSpacing: -0.6 },
  subtitle: { fontSize: 18, fontWeight: "600" as const, letterSpacing: -0.3 },
  body: { fontSize: 16, fontWeight: "400" as const },
  small: { fontSize: 14, fontWeight: "400" as const, color: colors.mute },
  micro: { fontSize: 12, fontWeight: "500" as const, letterSpacing: 1, textTransform: "uppercase" as const, color: colors.mute },
};
