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

export async function signOut() {
  await supabase.auth.signOut();
}
