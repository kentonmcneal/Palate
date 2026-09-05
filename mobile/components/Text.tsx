import { forwardRef } from "react";
import { Text as RNText, StyleSheet, type TextProps } from "react-native";
import { fonts } from "../theme";

// ============================================================================
// Text — every piece of text in the app, set in Inter.
// ----------------------------------------------------------------------------
// The app loads five Inter faces and the `type` scale in theme.ts uses them.
// Everything else — some four hundred styles written as `fontWeight: "700"`
// with no fontFamily — was meant to get Inter from a default set on
// `Text.defaultProps` in the root layout. React 19 removed defaultProps on
// function components, and React Native's Text is one, so that line has done
// nothing since the upgrade. Every raw-weight style has been rendering in San
// Francisco, and the founder noticed it first on Wrapped, which is almost
// entirely raw-weight styles.
//
// This is the only place that can fix it for all of them at once. It reads the
// resolved style, picks the Inter face for the weight, and sets the family
// explicitly. A style that names its own fontFamily is left alone.
//
// fontWeight is dropped once the family is chosen. Each Inter face is loaded
// as its own single-weight family, so the family already IS the weight;
// leaving fontWeight in place makes Android fake-bold a face that is already
// bold, and gives iOS a weight to search a one-face family for.
// ============================================================================

export function fontFamilyForWeight(w: string | number | undefined): string {
  const n = typeof w === "string"
    ? (w === "bold" ? 700 : w === "normal" ? 400 : parseInt(w, 10))
    : w ?? 400;
  if (n >= 800) return fonts.heavy;
  if (n >= 700) return fonts.bold;
  if (n >= 600) return fonts.semibold;
  if (n >= 500) return fonts.medium;
  return fonts.regular;
}

export const Text = forwardRef<RNText, TextProps>(function Text({ style, ...rest }, ref) {
  const flat = StyleSheet.flatten(style) ?? {};
  const hasFamily = typeof (flat as { fontFamily?: string }).fontFamily === "string";
  const { fontWeight, ...keep } = flat as { fontWeight?: string | number };
  const resolved = hasFamily
    ? flat
    : { ...keep, fontFamily: fontFamilyForWeight(fontWeight) };
  return <RNText ref={ref} {...rest} style={resolved} />;
});
