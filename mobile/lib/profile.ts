// ============================================================================
// profile.ts — per-user profile reads/writes that don't fit elsewhere.
// ----------------------------------------------------------------------------
// Currently: taste preferences captured during onboarding. Designed to grow
// as we add more user-level config without polluting auth.ts or visits.ts.
// ============================================================================

import { supabase } from "./supabase";

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  taste_preferences: string[];
  created_at: string;
};

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
