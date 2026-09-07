import { supabase } from "./supabase";
import * as Linking from "expo-linking";

/**
 * Sends a magic-link email. The link opens back into the app via the
 * "palate://" scheme (registered in app.json).
 */
export async function sendMagicLink(email: string) {
  const redirectTo = Linking.createURL("/auth-callback");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
  });
  if (error) throw error;
}

/**
 * Sign in with a 6-digit code emailed to the user.
 * (Alternate to magic link — works without deep linking.)
 */
export async function verifyEmailCode(email: string, code: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });
  if (error) throw error;
  return data;
}

/**
 * Sign in with a Google ID token obtained natively via expo-auth-session
 * (the iOS id_token flow — see sign-in.tsx). No email round-trip, so it's
 * the reliable path for users on domains that filter our OTP mail (e.g.
 * university / corporate addresses).
 *
 * Requires the Google provider enabled in Supabase with our iOS client id in
 * the authorized-client-id list. Nonce validation is skipped server-side
 * (external_google_skip_nonce_check) because expo-auth-session does not expose
 * the raw nonce for us to forward here.
 */
export async function signInWithGoogleIdToken(idToken: string) {
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });
  if (error) throw error;
  return data;
}

/**
 * Sign in with Apple. Required by App Store Review Guideline 4.8: an app that
 * offers a third-party login service must also offer one that limits data to
 * name and email AND lets somebody keep their email address private. Our other
 * option is an emailed code, which by definition cannot — you have to hand
 * over a working address to receive it. So Google sign-in without this is a
 * rejection, not a risk.
 *
 * Unlike the Google path above, this one carries a nonce. Apple accepts the
 * SHA-256 of a random string and embeds that hash in the token; Supabase is
 * handed the raw string and checks it matches. That is what stops a token
 * captured once from being replayed. expo-auth-session never exposed the raw
 * nonce for Google, which is why that path skips the check; here nothing is in
 * the way, so it is done properly.
 */
export async function signInWithAppleIdToken(idToken: string, rawNonce: string) {
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: idToken,
    nonce: rawNonce,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}
