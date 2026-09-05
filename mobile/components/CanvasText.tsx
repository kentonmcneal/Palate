import { type TextProps } from "react-native";
import { Text } from "./Text";

// ============================================================================
// CanvasText — text inside a share card, which is a picture, not an interface.
// ----------------------------------------------------------------------------
// WrappedCard, WrappedStoryCard, SharePalateCard and VisitShareCard are all
// rendered inside <ViewShot> and captured to a PNG. They are fixed-size
// canvases: a 280pt circle, a 1080-wide story frame, a stat row that has to
// line up.
//
// System font scaling MUST NOT apply to them. Not as a design preference — as
// correctness. If the OS scales this text to 235%, the capture doesn't become a
// more readable image, it becomes a clipped one: the persona name overruns the
// frame, the stat row wraps into the logo, and the user shares that. The
// accessibility setting is about reading the app; this output is an image the
// user sends to someone else, on whose device their setting means nothing.
//
// This is the same reason a photo of a menu doesn't reflow at large text sizes.
//
// Everywhere else in the app, text scales — see lib/a11y.ts. If you are reaching
// for this component outside a ViewShot subtree, you want FONT_CAP instead.
// ============================================================================

export function CanvasText(props: TextProps) {
  return <Text {...props} allowFontScaling={false} />;
}
