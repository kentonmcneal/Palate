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

export type JoinResult =
  | { ok: true; referralCode?: string }
  | { ok: false; message: string };

export async function joinWaitlist(
  email: string,
  source: string,
  referredBy?: string | null,
): Promise<JoinResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const client = getClient();

  // If supabase isn't configured, treat as a soft success so the UI still
  // works during local/preview builds. Production will have env vars set.
  if (!client) return { ok: true };

  // INSERT — referral_code is filled by the BEFORE-INSERT trigger.
  // .select() reads back the row so we get the code without a second roundtrip.
  const { data, error } = await client
    .from("waitlist")
    .insert({
      email: normalizedEmail,
      source,
      referred_by: referredBy ?? null,
    })
    .select("referral_code")
    .maybeSingle();

  let referralCode: string | undefined =
    typeof data?.referral_code === "string" ? data.referral_code : undefined;

  if (error) {
    if (error.code === "23505") {
      // Already on the list — fetch their existing code so the success UI
      // can still show it.
      const { data: existing } = await client
        .from("waitlist")
        .select("referral_code")
        .eq("email", normalizedEmail)
        .maybeSingle();
      referralCode = (existing?.referral_code as string | undefined) ?? referralCode;
      return { ok: true, referralCode };
    }
    return { ok: false, message: error.message };
  }

  // Fire welcome email — server route, never blocks the response.
  if (referralCode) {
    void fetch("/api/waitlist/welcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail, referralCode }),
    }).catch(() => {});
  }

  return { ok: true, referralCode };
}

/** Public RPC wrapper for the "X friends signed up via your link" counter. */
export async function getReferralCount(referralCode: string): Promise<number> {
  try {
    const client = getClient();
    if (!client) return 0;
    const { data, error } = await client.rpc("waitlist_referral_count", {
      code: referralCode,
    });
    if (error) return 0;
    const n = typeof data === "number" ? data : Number(data);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
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
    const n = Number(data);
    return Number.isFinite(n) && n >= 0 ? n : FALLBACK_COUNT;
  } catch {
    return FALLBACK_COUNT;
  }
}
