import { forwardRef } from "react";
import { TextInput as RNTextInput, StyleSheet, type TextInputProps } from "react-native";
import { fontFamilyForWeight } from "./Text";

// Same job as components/Text, for inputs. A search field in San Francisco
// next to a label in Inter is the kind of thing nobody can name and everyone
// notices. A style that sets its own fontFamily is left alone.
export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(
  { style, ...rest }, ref,
) {
  const flat = StyleSheet.flatten(style) ?? {};
  const hasFamily = typeof (flat as { fontFamily?: string }).fontFamily === "string";
  const { fontWeight, ...keep } = flat as { fontWeight?: string | number };
  const resolved = hasFamily ? flat : { ...keep, fontFamily: fontFamilyForWeight(fontWeight) };
  return <RNTextInput ref={ref} {...rest} style={resolved} />;
});
