// ============================================================================
// profile.ts — per-user profile reads/writes that don't fit elsewhere.
// ----------------------------------------------------------------------------
// Currently: taste preferences captured during onboarding. Designed to grow
// as we add more user-level config without polluting auth.ts or visits.ts.
// ============================================================================

import { supabase } from "./supabase";

export type ProfileVisibility = "private" | "friends" | "public";

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  taste_preferences: string[];
  profile_visibility: ProfileVisibility;
  created_at: string;
};

export async function getMyProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, username, avatar_url, taste_preferences, profile_visibility, created_at")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data as Profile;
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
    })
    .eq("id", user.id);
  if (error) throw error;
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
