// ============================================================================
// referral.ts — browser-safe referral helpers.
// ----------------------------------------------------------------------------
// The actual referral_code is computed server-side by a Postgres trigger
// (see supabase/migrations/0006_referrals.sql). This module only handles:
//   - reading ?ref= from the URL
//   - persisting it across navigation via localStorage
//   - building share URLs
// ============================================================================

export const REFERRAL_PARAM = "ref";
export const REFERRAL_BUMP_AT = 3; // 3 referrals -> "skip 50 spots"
const REFERRAL_STORAGE_KEY = "palate.referredBy";

/** Read ?ref=CODE from the current browser URL and persist it across reloads. */
export function captureRefFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const fresh = params.get(REFERRAL_PARAM);
    if (fresh && fresh.length <= 32) {
      window.localStorage.setItem(REFERRAL_STORAGE_KEY, fresh);
      return fresh;
    }
    return window.localStorage.getItem(REFERRAL_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function shareUrlFor(code: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://palate.app";
  return `${origin}/?ref=${code}`;
}
