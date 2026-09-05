import { useEffect, useState } from "react";
import { View, StyleSheet, Alert } from "react-native";
import { Text } from "../components/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button, Spacer } from "../components/Button";
import { UsernameField } from "../components/UsernameField";
import { colors, spacing, type } from "../theme";
import { getMyProfile, setUsername } from "../lib/profile";
import { validateUsername, suggestUsername } from "../lib/username";
import { track } from "../lib/analytics";
import { markUsernameClaimed } from "../lib/username-gate";

/**
 * Claiming a handle, for accounts that predate it being required.
 *
 * Every account created before this had no username, and the new signup step
 * only helps people who sign up after it. Those accounts are not identifiable
 * anywhere any more: the profile stopped showing login emails, and the feed
 * and profile fall back to display name, then @handle, then "Someone". An
 * established account with neither is literally anonymous to its own friends.
 *
 * Deliberately has no back button and no skip — it is routed to by the guard
 * in _layout and the only way out is forward. That is a hard thing to do to
 * somebody mid-session, which is why it asks for exactly one field and nothing
 * else.
 */
export default function ClaimUsername() {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    void getMyProfile()
      .then((p) => {
        if (!p) return;
        setName(p.display_name);
        setHandle((h) => h || suggestUsername(p.email, p.display_name));
      })
      .catch(() => {});
  }, []);

  async function save() {
    const check = validateUsername(handle);
    if (!check.ok) { setError(check.message); return; }

    setSaving(true);
    setError(null);
    try {
      const claimed = await setUsername(check.value);
      if (!claimed.ok) {
        setError(
          claimed.reason === "taken"
            ? `@${check.value} is taken. Try another.`
            : "Couldn't save that handle. Try again.",
        );
        return;
      }
      // Synchronously, and BEFORE navigating: the route guard reads this on
      // its next run, which happens the instant we replace below.
      markUsernameClaimed();
      void track("username_claimed", { surface: "gate" });
      router.replace("/(tabs)");
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "Try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={styles.h1}>Pick your handle.</Text>
        <Spacer size={10} />
        <Text style={styles.p}>
          {name ? `You're ${name} on here. ` : ""}
          Palate now shows a handle instead of your email address, so this is how
          people will find and recognise you.
        </Text>

        <Spacer size={30} />
        <UsernameField
          value={handle}
          onChange={(v) => { setHandle(v); setError(null); }}
          error={error}
          autoFocus
        />
      </View>

      <View style={styles.cta}>
        <Button title={saving ? "Saving…" : "Continue"} onPress={save} loading={saving} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper, justifyContent: "space-between" },
  body: { padding: spacing.lg, paddingTop: spacing.xxl },
  cta: { padding: spacing.lg },
  h1: { ...type.display, fontSize: 30, lineHeight: 35 },
  p: { ...type.body, color: colors.mute, lineHeight: 23 },
});
