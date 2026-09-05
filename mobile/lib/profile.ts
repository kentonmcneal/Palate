// ============================================================================
// profile.ts — per-user profile reads/writes that don't fit elsewhere.
// ----------------------------------------------------------------------------
// Currently: taste preferences captured during onboarding. Designed to grow
// as we add more user-level config without polluting auth.ts or visits.ts.
// ============================================================================

import { supabase } from "./supabase";

export type ProfileVisibility = "private" | "friends" | "public";

export type AgeRange = "under_18" | "18_24" | "25_34" | "35_44" | "45_54" | "55_64" | "65_plus";

export type Demographics = {
  age_range: AgeRange | null;
  gender_identity: string | null;
  race_ethnicity: string[];
  hometown: string | null;
  current_city: string | null;
};

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  taste_preferences: string[];
  profile_visibility: ProfileVisibility;
  age_range: AgeRange | null;
  gender_identity: string | null;
  race_ethnicity: string[];
  hometown: string | null;
  current_city: string | null;
  created_at: string;
};

export async function getMyProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, username, avatar_url, taste_preferences, profile_visibility, age_range, gender_identity, race_ethnicity, hometown, current_city, created_at")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data as Profile;
}

export async function saveDemographics(d: Partial<Demographics>): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase.from("profiles").update(d).eq("id", user.id);
  if (error) throw error;
}

export async function setUsername(handle: string): Promise<{ ok: true } | { ok: false; reason: "taken" | "invalid" | "error" }> {
  const cleaned = handle.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (cleaned.length < 3 || cleaned.length > 20) return { ok: false, reason: "invalid" };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "error" };
  const { error } = await supabase
    .from("profiles")
    .update({ username: cleaned })
    .eq("id", user.id);
  if (error) {
    if ((error as any).code === "23505" || `${error.message}`.toLowerCase().includes("unique")) {
      return { ok: false, reason: "taken" };
    }
    return { ok: false, reason: "error" };
  }
  return { ok: true };
}

export async function setProfileVisibility(v: ProfileVisibility): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("profiles")
    .update({ profile_visibility: v })
    .eq("id", user.id);
  if (error) throw error;
}

export async function setDisplayName(name: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: name.trim() || null })
    .eq("id", user.id);
  if (error) throw error;
}

// ============================================================================
// Public profile snapshot — what a friend sees when they view you, or what
// you see when you tap into a friend's profile.
// ============================================================================

export type FriendProfileSnapshot = {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  profile_visibility: ProfileVisibility;
  persona_label: string | null;
  persona_tagline: string | null;
  top_restaurant: string | null;
  unique_restaurants: number | null;
  total_visits: number | null;
  is_friend: boolean;
  is_self: boolean;
  // Profile content, not identity: null for a private profile, and for a
  // friends-only profile viewed by a non-friend (enforced in the RPC).
  bio: string | null;
  school: string | null;
  current_city: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  // Visits the owner has kept off their profile. Null for everyone but the
  // owner — a friend must not be able to tell a curated profile from a
  // complete one, which a zero-vs-null distinction would give away.
  hidden_visits: number | null;
  // Public identity. `email` is null for everyone but the owner as of 0080, so
  // this is what a profile falls back to when there is no display name — a
  // login address is not an identifier and must never appear on someone
  // else's screen.
  username: string | null;
  /** 'self' | 'accepted' | 'pending_out' | 'pending_in' | 'none'.
   *  is_friend only ever meant 'accepted', so a request you had just sent
   *  rendered identically to one you had never sent. */
  friend_state: "self" | "accepted" | "pending_out" | "pending_in" | "none";
};

export async function getFriendProfileSnapshot(targetId: string): Promise<FriendProfileSnapshot | null> {
  const { data, error } = await supabase
    .rpc("get_friend_profile_snapshot", { target_id: targetId });
  if (error) throw error;
  const row = (data as any[])?.[0];
  if (!row) return null;
  return row as FriendProfileSnapshot;
}

export async function saveQuizResult(personaKey: string, chips: string[]): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("profiles")
    .update({
      quiz_persona: personaKey,
      quiz_chips: chips,
      quiz_completed_at: new Date().toISOString(),
      onboarding_complete: true,
    })
    .eq("id", user.id);
  if (error) throw error;
}

/**
 * Whether the signed-in user should SKIP onboarding. True if they've finished
 * onboarding (server flag) OR completed the Starter quiz (persona set) — the
 * persona check covers accounts created before the `onboarding_complete`
 * column existed and is backfilled by migration 0041.
 *
 * Fails CLOSED: on a query error we treat the user as already onboarded, so a
 * transient network blip right after login can't re-run the wizard for an
 * established account. (A brand-new account on a successful read still has both
 * false/null and is correctly routed to onboarding.)
 */
export async function hasCompletedOnboarding(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from("profiles")
    .select("onboarding_complete, quiz_persona")
    .eq("id", user.id)
    .maybeSingle();
  if (error) return true; // fail closed — never re-onboard on a transient error
  return Boolean(data?.onboarding_complete) || data?.quiz_persona != null;
}

export async function getQuizPersona(): Promise<{ persona: string | null; chips: string[] }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { persona: null, chips: [] };
  const { data } = await supabase
    .from("profiles")
    .select("quiz_persona, quiz_chips")
    .eq("id", user.id)
    .maybeSingle();
  return {
    persona: (data?.quiz_persona as string | null) ?? null,
    chips: (data?.quiz_chips as string[] | null) ?? [],
  };
}

export async function saveTastePreferences(cuisines: string[]): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("profiles")
    .update({ taste_preferences: cuisines })
    .eq("id", user.id);
  if (error) throw error;
}

export async function getTastePreferences(): Promise<string[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("taste_preferences")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return [];
  return (data.taste_preferences as string[] | null) ?? [];
}

// ============================================================================
// Avatar upload — pushes to the public 'avatars' bucket, namespaced by user id.
// Returns the public URL written to profiles.avatar_url.
// ============================================================================
export async function uploadAvatar(uri: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const ext = (uri.split(".").pop() || "jpg").toLowerCase().slice(0, 4);
  const path = `${user.id}/${Date.now()}.${ext}`;

  // Read the file as binary. Expo image picker URIs are file:// — we have to
  // fetch -> arrayBuffer ourselves; the supabase JS client otherwise sends
  // an empty blob on RN.
  const resp = await fetch(uri);
  const buf = await resp.arrayBuffer();

  const { error: uploadErr } = await supabase.storage
    .from("avatars")
    .upload(path, buf, {
      contentType: ext === "png" ? "image/png" : "image/jpeg",
      upsert: false,
    });
  if (uploadErr) throw uploadErr;

  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
  const url = pub.publicUrl;

  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ avatar_url: url })
    .eq("id", user.id);
  if (updateErr) throw updateErr;

  return url;
}

// ============================================================================
// Palate matches — "you and Maya keep landing at the same places".
// ============================================================================
// Deliberately count-free. The RPC (0074) returns names and one example place
// and nothing rankable, because the moment this shows a number it becomes a
// standing people compare themselves against. Reciprocity and the friends-only
// gate are enforced server-side; there is no client flag that loosens them.

export type PalateMatchPeer = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  shared_place: string | null;
};

export async function loadPalateMatches(
  targetId: string,
  limit = 3,
): Promise<PalateMatchPeer[]> {
  const { data, error } = await supabase
    .rpc("palate_matches", { target_id: targetId, p_limit: limit });
  // A profile you cannot see returns an empty set rather than an error, so a
  // failure here is genuinely unexpected — surface nothing, log nothing loud.
  if (error) return [];
  return (data as PalateMatchPeer[]) ?? [];
}
