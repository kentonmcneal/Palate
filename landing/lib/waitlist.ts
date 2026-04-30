import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

const FALLBACK_COUNT = 352;

function getClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key);
  return cached;
}

export type JoinResult = { ok: true } | { ok: false; message: string };

export async function joinWaitlist(
  email: string,
  source: string,
): Promise<JoinResult> {
  const client = getClient();
  // If supabase isn't configured, treat as a soft success so the UI still
  // works during local/preview builds. Production will have env vars set.
  if (!client) return { ok: true };

  const { error } = await client
    .from("waitlist")
    .insert({ email: email.trim().toLowerCase(), source });

  if (error) {
    // duplicate is fine — already on the list
    if (error.code === "23505") return { ok: true };
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

/**
 * Fetches the current waitlist count via the public `get_waitlist_count`
 * RPC. The function is SECURITY DEFINER on the server so the anon key is
 * sufficient — RLS on `waitlist` still blocks raw row reads.
 *
 * Returns FALLBACK_COUNT on any failure (missing env vars during build,
 * RPC error, network issue) so the UI never breaks.
 */
export async function getWaitlistCount(): Promise<number> {
  try {
    const client = getClient();
    if (!client) return FALLBACK_COUNT;
    const { data, error } = await client.rpc("get_waitlist_count");
    if (error) return FALLBACK_COUNT;
    if (typeof data === "number") return data;
    // Some RPC responses come back as numeric strings; coerce.
    const n = Number(data);
    return Number.isFinite(n) && n >= 0 ? n : FALLBACK_COUNT;
  } catch {
    return FALLBACK_COUNT;
  }
}
