import { supabase } from "./supabase";
import { usernameGateSession, isUsernameGateSession, type UsernameSession } from "./username-gate";

// Reuse the account generation already advanced synchronously by RootLayout.
// This adapter gives non-username writers neutral names without a second clock.
export type AccountWriteSession = UsernameSession;
export const accountWriteSession = usernameGateSession;
export const isAccountWriteSession = isUsernameGateSession;
export function assertAccountWriteSession(token: AccountWriteSession): void {
  if (!isAccountWriteSession(token)) throw new Error("Account changed. Please try again.");
}
export async function requireAccountWriteUser(token: AccountWriteSession): Promise<string> {
  assertAccountWriteSession(token);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  assertAccountWriteSession(token);
  if (!user || user.id !== token.accountId) throw new Error("Account changed. Please try again.");
  return user.id;
}

// Destructive caller-scoped endpoints need the initiating JWT as well as a
// UI token: never let deferred SDK auth resolution substitute another account.
export async function accountWriteAuthorization(token: AccountWriteSession): Promise<string> {
  assertAccountWriteSession(token);
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  assertAccountWriteSession(token);
  if (!session?.access_token || session.user.id !== token.accountId) {
    throw new Error("Account changed. Please try again.");
  }
  return `Bearer ${session.access_token}`;
}
