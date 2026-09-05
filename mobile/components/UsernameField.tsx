import { View, TextInput, StyleSheet } from "react-native";
import { Text } from "./Text";
import { colors, spacing, type } from "../theme";
import { validateUsername, USERNAME_MAX } from "../lib/username";

/**
 * The one required field at signup, and the same control on the screen that
 * asks established accounts to claim one.
 *
 * Shows the stored form live — the "@handle" line under the input — because
 * the rule lowercases, and somebody typing "Kenton" should see "@kenton" before
 * they commit rather than discover it on their profile later.
 */
export function UsernameField({
  value, onChange, error, autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Server-side result, e.g. the handle is taken. Outranks local validation. */
  error?: string | null;
  autoFocus?: boolean;
}) {
  const local = validateUsername(value);
  const showLocalError = value.trim().length > 0 && !local.ok;
  const message = error ?? (showLocalError && !local.ok ? local.message : null);

  return (
    <View>
      <Text style={styles.label}>USERNAME</Text>
      <View style={[styles.inputWrap, message ? styles.inputWrapError : null]}>
        <Text style={styles.at}>@</Text>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="kenton"
          placeholderTextColor={colors.mute}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          maxLength={USERNAME_MAX + 6}
          style={styles.input}
          returnKeyType="done"
          accessibilityLabel="Username"
        />
      </View>
      {message ? (
        <Text style={styles.error}>{message}</Text>
      ) : local.ok && local.value !== value.trim() ? (
        <Text style={styles.hint}>Saved as @{local.value}</Text>
      ) : (
        <Text style={styles.hint}>How friends find you. You can change it later.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...type.micro, marginBottom: 8 },
  inputWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderColor: colors.line, borderRadius: 12,
    backgroundColor: colors.faint, paddingHorizontal: 14, height: 50,
  },
  inputWrapError: { borderColor: colors.red },
  at: { fontSize: 17, color: colors.mute, marginRight: 2 },
  input: { flex: 1, fontSize: 17, color: colors.ink, height: "100%" },
  error: { ...type.small, color: colors.redText, marginTop: 6, fontWeight: "600" },
  hint: { ...type.small, marginTop: 6 },
});
