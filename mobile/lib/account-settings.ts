import { supabase } from "./supabase";
import { accountWriteAuthorization, assertAccountWriteSession, type AccountWriteSession } from "./account-write";

export async function deleteHistoryForAccount(token: AccountWriteSession) {
  const authorization = await accountWriteAuthorization(token);
  assertAccountWriteSession(token);
  return supabase.rpc("delete_my_history").setHeader("Authorization", authorization);
}
export async function deleteAccountForAccount(token: AccountWriteSession) {
  const authorization = await accountWriteAuthorization(token);
  assertAccountWriteSession(token);
  return supabase.functions.invoke("delete-account", {
    body: {}, headers: { Authorization: authorization },
  });
}
