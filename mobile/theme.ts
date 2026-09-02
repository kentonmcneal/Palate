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
  // Live-status green. Used ONLY for "we have a real GPS fix" on the location
  // pill — a status light, never a brand accent. Muted enough to sit beside
  // the ember red without competing with it.
  live: "#2E7D5B",
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
  md: 16,   // the standard card radius — one value, used everywhere
  lg: 20,
  full: 999,
};

// One card shadow for the whole app. Cards were previously distinguished by a
// mix of borders, four different radii and no shadow at all, which is a large
// part of why the UI read as assembled rather than designed. A card is: white,
// radius.md, 16 padding, this shadow, no border.
export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;

// Card geometry, so "a card" means one thing.
export const card = {
  padding: 16,
  gap: 12,
  radius: radius.md,
} as const;

// Font families come from @expo-google-fonts — loaded in app/_layout.tsx.
// Inter only, mapped per weight because RN doesn't synthesize weights well.
// An editorial serif (Fraunces) used to carry display + titles; the
// OpenTable/Airbnb direction dropped it, and it stayed in the font loader for
// a while afterwards — downloaded and blocking the splash, rendered nowhere.
export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  heavy: "Inter_800ExtraBold",
  // Full clean-sans: display roles use Inter's heavy weights.
  display: "Inter_800ExtraBold",
  displaySemi: "Inter_700Bold",
};

// FOUR sizes, plus an eyebrow. The old scale ran 36/24/18/16/14/12 and every
// screen also set its own fontSize, so nothing lined up between surfaces.
// Weight comes from the font family only — never a numeric fontWeight
// alongside it, which is what made headings render inconsistently across
// iOS versions.
export const type = {
  display: { fontFamily: fonts.display, fontSize: 32, letterSpacing: -0.9, lineHeight: 37 },
  title: { fontFamily: fonts.displaySemi, fontSize: 20, letterSpacing: -0.4, lineHeight: 25 },
  subtitle: { fontFamily: fonts.semibold, fontSize: 16, letterSpacing: -0.2, lineHeight: 21 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.mute },
  micro: { fontFamily: fonts.medium, fontSize: 11, letterSpacing: 0.9, textTransform: "uppercase" as const, color: colors.mute },
};
