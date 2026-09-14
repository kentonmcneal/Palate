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
  /**
   * The red a WHITE LABEL may sit on. #E0473C is 4.09:1 against white, which
   * fails WCAG AA for text (4.5:1) — every primary button in the app failed,
   * measured, not guessed. This is 5.37:1.
   *
   * Separate from `red` on purpose. `red` stays the brand accent for fills
   * that carry no text — the heart, the flame, a checked box, a rail — where
   * the rule is 3:1 for non-text and 4.09 already clears it. Darkening the
   * brand everywhere to fix a text problem would be a design decision, not a
   * bug fix.
   */
  primaryFill: "#C13A2F",
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
  // Tonal fill for controls that sit ON a white card. `faint` became pure
  // white in the re-skin, so every chip still using it as a FILL — the Maps
  // buttons, the dismiss ✕, a saved Save — is white on white and reads as an
  // outline only. This is the ground those controls were drawn against. It is
  // a large part of what "aesthetically bland" actually looks like.
  wash: "#F1F1F1",
  // Live-status green. Used ONLY for "we have a real GPS fix" on the location
  // pill — a status light, never a brand accent. Muted enough to sit beside
  // the ember red without competing with it.
  live: "#2E7D5B",
};

// Secondary palette — warm, on-brand category hues for cuisine tags, trending
// shelves, and data viz. Previously these surfaces were all mono; this gives
// them a legible, ownable color language that doesn't fight the red.
// One family, six steps. The keys are unchanged so nothing at the call sites
// moves; only the hues do.
//
// The six used to be genuinely different colours — pine green, plum purple,
// olive — which gave every cuisine its own identity and gave the app six
// identities. The founder's call on 2026-09-12: keep everything coloured, in
// the terracotta palette the app had before the split. So these are now a warm
// ramp around the original red (#E0473C) and terracotta (#C2603A): they still
// tell one cuisine from another at a glance, and they no longer look like six
// different apps sharing a tab bar.
//
// Names kept rather than renamed to hex-accurate ones (nothing here is pine or
// plum now) because they are referenced in a dozen components and a rename is
// churn that would make this diff unreadable. The value is the decision.
export const categoryColors = {
  terracotta: "#C2603A",  // the anchor
  saffron: "#D9873A",     // warm amber, still reads as gold on a star
  olive: "#A8663C",       // toasted, was a green
  pine: "#8F4331",        // deep rust, was a teal
  plum: "#B04A3C",        // brick red, was a purple
  clay: "#C98150",        // sand, the lightest step
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
  stat: { fontFamily: fonts.display, fontSize: 24, letterSpacing: -0.6, lineHeight: 28 },
  title: { fontFamily: fonts.displaySemi, fontSize: 20, letterSpacing: -0.4, lineHeight: 25 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, lineHeight: 23 },
  subtitle: { fontFamily: fonts.semibold, fontSize: 16, letterSpacing: -0.2, lineHeight: 21 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.mute },
  micro: { fontFamily: fonts.medium, fontSize: 11, letterSpacing: 0.9, textTransform: "uppercase" as const, color: colors.mute },
  badge: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.4 },
};

/**
 * The only sizes any screen may set.
 *
 * The scale above defines seven roles, and the app had grown twenty-five
 * distinct font sizes on top of them: 12 and 14 either side of small, 15 and
 * 17 either side of body, 19, 21 and 22 around title. None of it was a
 * decision, it was each screen guessing, and it is why the tabs did not look
 * like one app. Anything not on this ladder now fails a test
 * (lib/__tests__/type-scale.test.ts), so the next size is a deliberate step
 * added here rather than a number typed into a stylesheet.
 *
 * The Wrapped story is exempt: it is full-bleed typography where the number
 * IS the design, and its heroes run to 92.
 */
export const TYPE_SCALE = [10, 11, 13, 16, 18, 20, 24, 28, 32] as const;
