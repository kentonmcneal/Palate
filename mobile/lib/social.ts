// ============================================================================
// social.ts — the people layer: your card, and everyone else's.
// ----------------------------------------------------------------------------
// Beli's social graph is why people stay on it. Palate had friendships and a
// feed but no profile worth visiting and no way to find anyone you didn't
// already know by email.
//
// Two halves:
//   • the fields that make a profile a profile — bio, school, IG, TikTok
//   • browseProfiles(), the directory, ranked by palate match rather than by
//     recency. Sorting people by taste compatibility is the thing Beli cannot
//     do, and we already have the scorer.
//
// Visibility is enforced SERVER-side in browse_profiles (migration 0056), not
// filtered here. Who is visible is not a UI concern — a client-side filter is
// one refactor away from leaking someone who opted out.
// ============================================================================

import { supabase } from "./supabase";

export type PublicProfile = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  school: string | null;
  current_city: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  quiz_persona: string | null;
};

export type SocialFields = {
  bio: string | null;
  school: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
};

export const BIO_MAX = 160;
export const SCHOOL_MAX = 60;

/**
 * Normalize what someone types into a bare handle. People paste all of
 * "@name", "instagram.com/name", "https://www.tiktok.com/@name" — storing any
 * of those verbatim produces a broken link later, so we reduce to the handle
 * and let the UI rebuild the URL.
 *
 * Returns null for empty or unusable input rather than a half-cleaned string.
 */
export function normalizeHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;

  // Strip a full URL down to its last path segment.
  const urlMatch = /(?:instagram\.com|tiktok\.com)\/+@?([^/?#\s]+)/i.exec(s);
  if (urlMatch) s = urlMatch[1];

  s = s.replace(/^@+/, "").replace(/\/+$/, "").trim();
  // Must match what migration 0056's CHECK constraints accept, or the write
  // fails at the database with an error the user can't act on.
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) return null;
  return s;
}

export function instagramUrl(handle: string): string {
  return `https://instagram.com/${handle}`;
}

export function tiktokUrl(handle: string): string {
  return `https://tiktok.com/@${handle}`;
}

export async function saveSocialFields(input: {
  bio?: string | null;
  school?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const patch: Record<string, string | null> = {};
  if (input.bio !== undefined) {
    const b = (input.bio ?? "").trim();
    patch.bio = b ? b.slice(0, BIO_MAX) : null;
  }
  if (input.school !== undefined) {
    const s = (input.school ?? "").trim();
    patch.school = s ? s.slice(0, SCHOOL_MAX) : null;
  }
  if (input.instagram !== undefined) patch.instagram_handle = normalizeHandle(input.instagram);
  if (input.tiktok !== undefined) patch.tiktok_handle = normalizeHandle(input.tiktok);

  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
  if (error) throw error;
}

/** One page of the directory. Server decides who is in it. */
export async function browseProfiles(limit = 50, offset = 0): Promise<PublicProfile[]> {
  const { data, error } = await supabase.rpc("browse_profiles", {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as PublicProfile[];
}

/**
 * Has this account been asked about discoverability yet?
 *
 * New accounts default to public and are never asked. Accounts created before
 * the directory existed signed up under `friends`, and are asked once rather
 * than being switched for them.
 */
export async function needsDiscoveryPrompt(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("profiles")
    .select("profile_visibility, discovery_prompted_at, created_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!data) return false;
  if (data.discovery_prompted_at) return false;
  return data.profile_visibility !== "public";
}

export async function markDiscoveryPrompted(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("profiles")
    .update({ discovery_prompted_at: new Date().toISOString() })
    .eq("id", user.id);
}
