// One-sentence editorial blurb for the restaurant detail screen.
//
// Fires the places-proxy `blurb` action, which returns a cached Haiku-
// generated sentence (or generates one fresh from review snippets if cache
// is empty / stale). Returns null when no reviews exist or the LLM key is
// not configured — caller should hide the slot in that case.

import { supabase } from "./supabase";

export async function loadEditorialBlurb(googlePlaceId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke("places-proxy", {
      body: { action: "blurb", place_id: googlePlaceId },
    });
    if (error) return null;
    const blurb = (data as { blurb?: string | null })?.blurb;
    return typeof blurb === "string" && blurb.length > 0 ? blurb : null;
  } catch {
    return null;
  }
}
