import Svg, { Rect, Circle, Path } from "react-native-svg";
import { colors } from "../theme";

// ============================================================================
// SocialGlyph — the profile's outbound social links, drawn rather than named.
// ----------------------------------------------------------------------------
// The links read "Instagram" and "TikTok" in text chips. A logo is faster to
// find and takes less room, but no icon set is installed and adding one is a
// dependency plus font assets for two glyphs. react-native-svg is already a
// dependency and already in the shipped binary — components/Logo.tsx draws the
// wordmark with it — so these are paths, not a package, and they reach devices
// in an OTA with no new build.
//
// TRADEMARK, deliberately: this is the MONOCHROME OUTLINE camera, which is the
// form Meta's guidelines contemplate for a third party linking out to an
// account. The gradient mark is not reproduced — recolouring or redrawing THAT
// is the part the guidelines actually prohibit. Keep it one flat colour.
// ============================================================================

export function InstagramGlyph({
  size = 16,
  color = colors.ink,
}: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x="3.25" y="3.25" width="17.5" height="17.5" rx="5.25"
        stroke={color} strokeWidth="2" fill="none"
      />
      <Circle cx="12" cy="12" r="4.1" stroke={color} strokeWidth="2" fill="none" />
      <Circle cx="17.2" cy="6.8" r="1.25" fill={color} />
    </Svg>
  );
}

// A music note, NOT TikTok's mark. TikTok's guidelines are stricter than
// Meta's — they require the supplied logo files and forbid redrawing — so the
// safe glyph is a generic note that reads "video profile" without
// impersonating the brand. If the official asset is ever licensed, swap these
// two paths and every call site stays as it is.
export function TikTokGlyph({
  size = 16,
  color = colors.ink,
}: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M14.75 4.2v9.05a3.55 3.55 0 1 1-2.6-3.42"
        stroke={color} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
      <Path
        d="M14.75 5.4c.85 2.1 2.55 3.3 4.55 3.4"
        stroke={color} strokeWidth="2" strokeLinecap="round" fill="none"
      />
    </Svg>
  );
}
