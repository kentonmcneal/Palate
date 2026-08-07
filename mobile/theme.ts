// Palate brand tokens — single source of truth for colors + spacing.
//
// Unified with lib/theme/palateTheme.ts: one ember red, one warm white, warm
// neutrals. The two files used to disagree (red #FF3008 vs #FF2D16, pure vs
// warm white, cool vs warm grays) which made the diary/discovery surfaces feel
// like a different app from the Wrapped/identity surfaces. They now share a
// palette so the brand reads as one continuous system.

export const colors = {
  // OpenTable/Airbnb re-skin: one restrained accent on a clean, neutral ground.
  // Ember red pulled back from #E5391C — used ONLY where it earns attention
  // (primary CTA, match chip, save/active). Everything else is near-black/grey.
  red: "#E0473C",
  // Darker red strictly for small red TEXT on light backgrounds (WCAG AA).
  redText: "#C13A2F",
  primary: "#E0473C",
  primaryText: "#C13A2F",
  // Soft tint for selected chips / gentle accent surfaces.
  redTint: "#FDECEA",
  redTintBorder: "#F6D3CE",
  ink: "#222222",     // near-black (Airbnb/OpenTable body ink)
  paper: "#F6F6F6",   // light grey PAGE ground — cards sit on this as white
  mute: "#717171",    // neutral grey secondary text
  line: "#EBEBEB",    // hairline border, used sparingly (rely on shadow + space)
  inkDim: "#3A3A3A",
  faint: "#FFFFFF",   // white CARD surface — pops off the grey page
};

// Secondary palette — warm, on-brand category hues for cuisine tags, trending
// shelves, and data viz. Previously these surfaces were all mono; this gives
// them a legible, ownable color language that doesn't fight the red.
export const categoryColors = {
  terracotta: "#C2603A",
  saffron: "#D99A2B",
  olive: "#7C7A3E",
  pine: "#3C7A72",
  plum: "#7A3C5A",
  clay: "#A8553C",
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

// Font families come from @expo-google-fonts — loaded in app/_layout.tsx.
// Inter carries UI/body; Fraunces (an editorial high-contrast serif) carries
// display + titles so headlines read "premium editorial" instead of generic
// system-sans. Mapped per weight because RN doesn't synth weights well.
export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  heavy: "Inter_800ExtraBold",
  // Full clean-sans (OpenTable/Airbnb direction): display roles use Inter's
  // heavy weights instead of the Fraunces serif, for a clean, modern UI feel.
  display: "Inter_800ExtraBold",
  displaySemi: "Inter_700Bold",
};

export const type = {
  display: { fontFamily: fonts.display, fontSize: 36, letterSpacing: -1.2 },
  title: { fontFamily: fonts.display, fontSize: 24, letterSpacing: -0.5 },
  subtitle: { fontFamily: fonts.semibold, fontSize: 18, letterSpacing: -0.3 },
  body: { fontFamily: fonts.regular, fontSize: 16 },
  small: { fontFamily: fonts.regular, fontSize: 14, color: colors.mute },
  micro: { fontFamily: fonts.medium, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" as const, color: colors.mute },
};
