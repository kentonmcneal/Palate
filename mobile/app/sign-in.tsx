import { useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { Logo, Wordmark, LOGO_SIZE } from "../components/Logo";
import { Button, Spacer } from "../components/Button";
import { colors, spacing, type } from "../theme";
import * as Linking from "expo-linking";
import { sendMagicLink, verifyEmailCode, signInWithGoogleIdToken } from "../lib/auth";
import { hasCompletedOnboarding } from "../lib/profile";
import { isApproved } from "../lib/waitlist";
import { track } from "../lib/analytics";
import { recordReferral } from "../lib/referrals";

// Required for the auth-session browser redirect to close and hand control back
// to the app when Google sign-in completes.
WebBrowser.maybeCompleteAuthSession();

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Google native id_token flow. Reuses the iOS client id already in the app;
  // no email round-trip, so it works for users whose mail provider filters our
  // OTP (e.g. university / corporate addresses).
  const [gRequest, gResponse, gPromptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  });

  useEffect(() => {
    if (gResponse?.type !== "success") {
      if (gResponse?.type === "error") {
        setLoading(false);
        Alert.alert("Couldn't sign in with Google", "Please try again or use your email.");
      }
      return;
    }
    const idToken = gResponse.params?.id_token;
    if (!idToken) {
      setLoading(false);
      Alert.alert("Couldn't sign in with Google", "No credential returned. Try again.");
      return;
    }
    (async () => {
      setLoading(true);
      try {
        await signInWithGoogleIdToken(idToken);
        void track("sign_in_verified", { method: "google" });
        await finishSignIn();
      } catch (e: any) {
        Alert.alert("Couldn't sign in with Google", e.message ?? "Try again");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gResponse]);

  // Post-authentication routing, shared by the email-code and Google paths:
  // claim a pending referral, then gate on waitlist approval before onboarding.
  async function finishSignIn() {
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

    // Returning users skip onboarding and land in the tabs. We gate on a
    // dedicated onboarding-complete flag (backfilled for pre-quiz accounts)
    // rather than quiz_persona alone — older accounts have a null persona and
    // were being wrongly re-sent through the wizard on re-login.
    // Waitlist gate first — unapproved accounts land on the waitlist, not the app.
    if (!(await isApproved())) {
      router.replace("/waitlist");
      return;
    }
    const done = await hasCompletedOnboarding();
    router.replace(done ? "/(tabs)" : "/onboarding/welcome");
  }

  async function handleGoogle() {
    void track("sign_in_started", { method: "google" });
    setLoading(true);
    try {
      await gPromptAsync();
    } catch {
      setLoading(false);
    }
    // Success/failure is handled in the gResponse effect above.
  }

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
      void track("sign_in_verified", { method: "email" });
      await finishSignIn();
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

                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.dividerLine} />
                </View>

                <Button
                  title="Continue with Google"
                  variant="ghost"
                  onPress={handleGoogle}
                  loading={loading}
                  disabled={!gRequest}
                />
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
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: spacing.md,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.line },
  dividerText: { ...type.small, color: colors.mute, marginHorizontal: 12 },
});
