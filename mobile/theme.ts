// Palate brand tokens — single source of truth for colors + spacing.
//
// Unified with lib/theme/palateTheme.ts: one ember red, one warm white, warm
// neutrals. The two files used to disagree (red #FF3008 vs #FF2D16, pure vs
// warm white, cool vs warm grays) which made the diary/discovery surfaces feel
// like a different app from the Wrapped/identity surfaces. They now share a
// palette so the brand reads as one continuous system.

export const colors = {
  // Ember red — warmer and deeper than the old #FF3008 (which was, to the
  // pixel, DoorDash red). Harmonizes with the wine/oxblood identity palette.
  // Use sparingly: primary CTA, match score, active state — accent only.
  red: "#E5391C",
  // Darker red strictly for small red TEXT on warm-white backgrounds —
  // #E5391C as text fails WCAG AA (~3.6:1); this clears 4.5:1.
  redText: "#B82E12",
  // Semantic role tokens. Reach for `primary` (not `red`) when a component
  // wants THE one accent on a screen — the primary action or the signature
  // match score. Keeping a named role stops red from creeping back onto
  // incidental chrome (links, eyebrows, placeholders) over time.
  primary: "#E5391C",
  primaryText: "#B82E12",
  // Soft ember tints for selected chips / gentle accent cards. Derived from
  // the new ember (replaces the old DoorDash-derived #FFF1EE / #FFD7CE pair,
  // which read slightly off against warm white).
  redTint: "#FBEAE6",
  redTintBorder: "#F2CFC6",
  ink: "#141210",     // warm near-black (was #111111)
  paper: "#FAF7F4",   // warm white (was pure #FFFFFF — read clinical)
  mute: "#77706C",    // warm gray (was #6B6B6B)
  line: "#E7E2DF",    // warm border (was #EAEAEA)
  inkDim: "#2A2724",  // warm (was #2A2A2A)
  faint: "#F4F1EF",   // warm faint surface (was #F6F6F6)
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
  // Editorial display face — identity words, screen titles, hero headlines.
  display: "Fraunces_700Bold",
  displaySemi: "Fraunces_600SemiBold",
};

export const type = {
  display: { fontFamily: fonts.display, fontSize: 36, letterSpacing: -1.2 },
  title: { fontFamily: fonts.display, fontSize: 24, letterSpacing: -0.5 },
  subtitle: { fontFamily: fonts.semibold, fontSize: 18, letterSpacing: -0.3 },
  body: { fontFamily: fonts.regular, fontSize: 16 },
  small: { fontFamily: fonts.regular, fontSize: 14, color: colors.mute },
  micro: { fontFamily: fonts.medium, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" as const, color: colors.mute },
};
