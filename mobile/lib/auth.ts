import { supabase } from "./supabase";
import * as Linking from "expo-linking";
import { runAuthTransition } from "./auth-transition";
import { usernameGateSession, isUsernameGateSession, type UsernameSession } from "./username-gate";

// Await public SDK initialization before any replacement can write a session.
// Native provider prompts happen outside this queue; credential submission and
// the SDK's complete session persistence/notification happen inside it.
function transition<T>(operation: () => Promise<T>): Promise<T> {
  return runAuthTransition(async () => {
    await supabase.auth.getSession();
    return operation();
  });
}

/**
 * Sends a magic-link email. The link opens back into the app via the
 * "palate://" scheme (registered in app.json).
 */
export async function sendMagicLink(email: string) {
  const redirectTo = Linking.createURL("/auth-callback");
  const { error } = await transition(() => supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
  }));
  if (error) throw error;
}

/**
 * Sign in with a 6-digit code emailed to the user.
 * (Alternate to magic link — works without deep linking.)
 */
export async function verifyEmailCode(email: string, code: string) {
  const { data, error } = await transition(() => supabase.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  }));
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
  const { data, error } = await transition(() => supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  }));
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
  const { data, error } = await transition(() => supabase.auth.signInWithIdToken({
    provider: "apple",
    token: idToken,
    nonce: rawNonce,
  }));
  if (error) throw error;
  return data;
}

export async function signOut() {
  await signOutForAccount(usernameGateSession());
}

/** Skip stale deletion/logout intents; never clean up a replacement account.
 * All application session replacement must use this module's queued helpers.
 * A queued sign-in runs after the SDK has finished removing the old session.
 */
export function signOutForAccount(token: UsernameSession): Promise<boolean> {
  return runAuthTransition(async () => {
    if (!isUsernameGateSession(token)) return false;
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!isUsernameGateSession(token) || session?.user.id !== token.accountId) return false;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return true;
  });
}
