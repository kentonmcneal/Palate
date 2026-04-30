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
  taste_preferences: string[];
  profile_visibility: ProfileVisibility;
  created_at: string;
};

export async function getMyProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, taste_preferences, profile_visibility, created_at")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data as Profile;
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
