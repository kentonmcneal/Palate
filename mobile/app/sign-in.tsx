import { useState } from "react";
import { View, Text, TextInput, StyleSheet, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Logo, Wordmark, LOGO_SIZE } from "../components/Logo";
import { Button, Spacer } from "../components/Button";
import { colors, spacing, type } from "../theme";
import * as Linking from "expo-linking";
import { sendMagicLink, verifyEmailCode } from "../lib/auth";
import { getQuizPersona } from "../lib/profile";
import { track } from "../lib/analytics";
import { recordReferral } from "../lib/referrals";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSendCode() {
    if (!email.includes("@")) return Alert.alert("Hmm", "Enter a valid email");
    setLoading(true);
    try {
      await sendMagicLink(email.trim());
      void track("sign_in_started");
      setStage("code");
      Alert.alert("Check your inbox", "We sent you a 6-digit code.");
    } catch (e: any) {
      Alert.alert("Couldn't send code", e.message ?? "Try again");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    setLoading(true);
    try {
      await verifyEmailCode(email.trim(), code.trim());
      void track("sign_in_verified");

      // Claim a referral if the user arrived via a ?ref= link (handled by
      // expo-linking — works for universal links + custom-scheme deep links).
      try {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) {
          const parsed = Linking.parse(initialUrl);
          const ref = (parsed.queryParams?.ref ?? null) as string | null;
          if (ref) await recordReferral(ref);
        }
      } catch {
        // silent — referral is best-effort
      }

      // Returning users (already finished the Starter Palate quiz) skip
      // onboarding and land in the tabs. Otherwise run the wizard.
      const { persona } = await getQuizPersona();
      router.replace(persona ? "/(tabs)" : "/onboarding/welcome");
    } catch (e: any) {
      Alert.alert("Couldn't sign in", e.message ?? "Wrong code?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.container}>
          <View style={{ alignItems: "center" }}>
            <Logo size={LOGO_SIZE.hero} />
            <Spacer size={20} />
            <Text style={styles.h1}>Welcome to Palate</Text>
            <Text style={styles.sub}>Start to see how you actually eat.</Text>
          </View>

          <View style={{ marginTop: spacing.xxl }}>
            {stage === "email" ? (
              <>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@email.com"
                  placeholderTextColor={colors.mute}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  style={styles.input}
                />
                <Spacer />
                <Button title="Send code" onPress={handleSendCode} loading={loading} />
              </>
            ) : (
              <>
                <Text style={styles.label}>6-digit code</Text>
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  placeholder="123456"
                  placeholderTextColor={colors.mute}
                  keyboardType="number-pad"
                  maxLength={6}
                  style={[styles.input, { letterSpacing: 8, textAlign: "center" }]}
                />
                <Spacer />
                <Button title="Sign in" onPress={handleVerify} loading={loading} />
                <Spacer />
                <Button title="Use a different email" variant="ghost" onPress={() => setStage("email")} />
              </>
            )}
          </View>

          <View style={{ marginTop: "auto", alignItems: "center" }}>
            <Wordmark />
            <Text style={[type.small, { marginTop: 4 }]}>
              By signing in you agree to our Terms and Privacy.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, padding: spacing.lg, paddingTop: spacing.xxl },
  h1: { ...type.display, color: colors.ink, marginTop: 8 },
  sub: { ...type.body, color: colors.mute, marginTop: 6 },
  label: { ...type.micro, marginBottom: 8 },
  input: {
    height: 54,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    fontSize: 16,
    color: colors.ink,
  },
});
