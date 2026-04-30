// ============================================================================
// admin.ts — server-only helpers for the /admin waitlist viewer.
// ----------------------------------------------------------------------------
// Uses SUPABASE_SERVICE_ROLE_KEY (NOT the anon key) so we can bypass RLS and
// read waitlist rows directly. This file is server-only — `import "server-only"`
// makes Next.js throw if it ever gets bundled into client code.
// ============================================================================

import "server-only";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function adminClient() {
  if (!URL || !SERVICE_KEY) return null;
  return createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
}

export function isAdminKeyValid(provided: string | undefined): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  if (!provided) return false;
  return provided === expected;
}

export type WaitlistRow = {
  id: string;
  email: string;
  source: string | null;
  referral_code: string | null;
  referred_by: string | null;
  created_at: string;
};

export type WaitlistStats = {
  total: number;
  last7Days: number;
  bySource: Record<string, number>;
  topReferrers: Array<{ code: string; email: string | null; count: number }>;
  recent: WaitlistRow[];
};

export async function getWaitlistStats(): Promise<WaitlistStats | null> {
  const c = adminClient();
  if (!c) return null;

  const { count: total } = await c
    .from("waitlist")
    .select("id", { count: "exact", head: true });

  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { count: last7Days } = await c
    .from("waitlist")
    .select("id", { count: "exact", head: true })
    .gte("created_at", sevenDaysAgo);

  const { data: rows } = await c
    .from("waitlist")
    .select("id, email, source, referral_code, referred_by, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const bySource: Record<string, number> = {};
  const referralCounts = new Map<string, number>();
  for (const r of (rows ?? []) as WaitlistRow[]) {
    const src = r.source ?? "unknown";
    bySource[src] = (bySource[src] ?? 0) + 1;
    if (r.referred_by) {
      referralCounts.set(r.referred_by, (referralCounts.get(r.referred_by) ?? 0) + 1);
    }
  }

  // Resolve referrer codes -> emails for the top 5
  const topCodes = [...referralCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topReferrers: WaitlistStats["topReferrers"] = [];
  for (const [code, count] of topCodes) {
    const { data: referrer } = await c
      .from("waitlist")
      .select("email")
      .eq("referral_code", code)
      .maybeSingle();
    topReferrers.push({ code, email: referrer?.email ?? null, count });
  }

  return {
    total: total ?? 0,
    last7Days: last7Days ?? 0,
    bySource,
    topReferrers,
    recent: (rows ?? []) as WaitlistRow[],
  };
}
