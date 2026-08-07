// ============================================================================
// waitlist.ts — invite-only approval gate helpers.
// ----------------------------------------------------------------------------
// New accounts default to approval_status='pending' (see migration 0043) and
// are held on the waitlist screen until an admin approves them.
//
// isApproved() FAILS OPEN: on any query error (including the column not existing
// yet, before the migration deploys) it returns true. That means shipping this
// JS ahead of the migration can never lock anyone out, and a transient network
// error never strands a legitimate user on the waitlist.
// ============================================================================

import { supabase } from "./supabase";

export async function isApproved(): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from("profiles")
    .select("approval_status")
    .eq("id", user.id)
    .maybeSingle();
  if (error) return true; // fail open — never waitlist on a transient/pre-migration error
  return ((data?.approval_status as string | null) ?? "approved") === "approved";
}

export async function isAdmin(): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.is_admin);
}

export type PendingUser = {
  id: string;
  email: string | null;
  display_name: string | null;
};

export async function listPendingUsers(): Promise<PendingUser[]> {
  const { data, error } = await supabase.rpc("admin_list_pending");
  if (error) throw error;
  return (data ?? []) as PendingUser[];
}

export async function setApproval(
  targetId: string,
  status: "approved" | "rejected" | "pending",
): Promise<void> {
  const { error } = await supabase.rpc("admin_set_approval", {
    target_id: targetId,
    new_status: status,
  });
  if (error) throw error;
}

// Admin curation override — force a place out of (or back into) recommendations.
// The exclusion is enforced at the DB layer (migration 0044) so it survives
// re-classification. Use for venues Google mis-types as a food place (e.g. a
// music venue typed `bar`) that the classifier's food-gate can't catch.
export async function blacklistPlace(
  googlePlaceId: string,
  blacklisted = true,
): Promise<void> {
  const { error } = await supabase.rpc("admin_blacklist_place", {
    gpid: googlePlaceId,
    blacklisted,
  });
  if (error) throw error;
}

export type BlacklistedPlace = {
  google_place_id: string;
  name: string | null;
  neighborhood: string | null;
};

export async function listBlacklistedPlaces(): Promise<BlacklistedPlace[]> {
  const { data, error } = await supabase.rpc("admin_list_blacklisted");
  if (error) throw error;
  return (data ?? []) as BlacklistedPlace[];
}
