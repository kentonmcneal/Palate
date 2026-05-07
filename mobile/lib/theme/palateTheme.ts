// ============================================================================
// palateTheme.ts — design tokens for the Palate identity surfaces.
// ----------------------------------------------------------------------------
// "Behavioral luxury." Spotify Wrapped energy + Apple Health clarity +
// boutique hospitality polish. Single source of truth for colors, gradients,
// typography sizes, motion timings, spacing, radius, and shadow presets.
//
// IMPORTANT: This file lives PARALLEL to /theme.ts (the legacy app theme).
// Existing screens keep their imports from /theme. New Wrapped + identity
// surfaces import from here. Don't try to merge the two — they have
// different scopes and migrating wholesale would break unrelated UI.
// ============================================================================

import type { TextStyle } from "react-native";

// ----------------------------------------------------------------------------
// Colors — Palate's red identity, refined.
// ----------------------------------------------------------------------------
export const palateColors = {
  // Brand reds — ember accent over wine/oxblood backgrounds. Use red sparingly:
  // primary CTAs, identity highlights, active tab state, match score accent.
  red:        "#FF2D16",
  // Wine / burgundy / oxblood — for matte premium card backgrounds and the
  // story-mode gradient. These let us avoid bright flat red surfaces.
  wine:       "#5A0B14",
  burgundy:   "#711428",
  oxBlood:    "#3A080A",
  redDeep:    "#7A1208",   // legacy alias — keep so existing imports compile
  redWine:    "#3A0D09",   // legacy alias
  // Neutrals
  black:      "#0D0D0D",
  blackSoft:  "#151515",
  white:      "#FAF7F4",   // warm white, never pure
  graySoft:   "#F4F1EF",
  grayMid:    "#77706C",
  border:     "#E7E2DF",
} as const;

// ----------------------------------------------------------------------------
// Gradients — exact stops per spec. Use these on every story / share card.
// (LinearGradient `colors` prop accepts an array of stops.)
// ----------------------------------------------------------------------------
export const palateGradients = {
  /** Story-grade WINE → ox blood → near-black. Per redesign brief: avoid
   *  bright flat red screens. The hero gradient now radiates burgundy depth
   *  instead of saturated red. The brand-red ember stays for the identity
   *  word itself, painted over the gradient. */
  storyRed:   ["#5A0B14", "#3A080A", "#0D0D0D"] as [string, string, string],
  /** Subtle dark gradient for behavior + tag cards — slightly warmed so
   *  it doesn't read as flat charcoal. */
  storyDark:  ["#1F1414", "#0D0D0D"] as [string, string],
  /** Share card — wine depth + ox blood. */
  shareWine:  ["#711428", "#3A080A", "#0D0D0D"] as [string, string, string],
  /** Glow accent — radial halo behind identity headlines. Toned down per
   *  redesign brief (was 0.4 → 0.18). */
  identityGlow: "rgba(255,45,22,0.18)",
} as const;

// ----------------------------------------------------------------------------
// Spacing — 4px base scale.
// ----------------------------------------------------------------------------
export const palateSpacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
  xxxl: 64,
} as const;

// ----------------------------------------------------------------------------
// Border radius
// ----------------------------------------------------------------------------
export const palateRadius = {
  sm:  10,
  md:  16,
  lg:  22,
  xl:  28,
  pill: 999,
} as const;

// ----------------------------------------------------------------------------
// Typography — bold, editorial, premium.
// ----------------------------------------------------------------------------
export const palateType = {
  // Identity hero — "Forager"
  display: {
    fontSize: 56,
    fontWeight: "800",
    letterSpacing: -1.4,
    lineHeight: 60,
  } as TextStyle,
  // Section headlines
  headline: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.6,
    lineHeight: 34,
  } as TextStyle,
  // Subhead — secondary line under a headline
  subhead: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
    lineHeight: 24,
  } as TextStyle,
  // Body — explanation copy
  body: {
    fontSize: 15,
    fontWeight: "500",
    letterSpacing: 0,
    lineHeight: 22,
  } as TextStyle,
  // Eyebrow — uppercase labels
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase" as const,
  } as TextStyle,
  // Microcopy / chip text
  micro: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
  } as TextStyle,
} as const;

// ----------------------------------------------------------------------------
// Motion — premium, deliberate, never bouncy.
// ----------------------------------------------------------------------------
export const palateMotion = {
  // Speed buckets
  fast:       180,   // taps, chip pop-ins
  standard:   300,   // identity reveal, card transitions
  expressive: 600,   // chart count-ups, hero reveals
  /** Pulse cycle for the axis user dot — 1.25s up + 1.25s down (one full
   *  pulse every 2.5s, slow heartbeat per design bible). */
  pulseHalf:  1250,

  // Stagger between sequential elements (e.g. tag chips fading in)
  staggerStep: 40,

  // Reveal offsets
  reveal: {
    translateY: 8,    // translateY start before fade-in
    scaleStart: 0.98, // optional scale-from for hero
  },
} as const;

// ----------------------------------------------------------------------------
// Shadows — colored shadows for cards that should "glow" with the brand.
// ----------------------------------------------------------------------------
export const palateShadow = {
  /** Soft red glow under hero / identity cards. Toned down 50% from prior
   *  build per redesign brief. */
  redGlow: {
    shadowColor: palateColors.red,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  /** Neutral lift for paper-stock cards. */
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} as const;
