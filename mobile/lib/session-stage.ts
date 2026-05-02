// ============================================================================
// session-stage.ts — first 3 sessions, progressive value reveal.
// ----------------------------------------------------------------------------
// Maps a user's visit count to a session stage that gates how much identity
// content the UI surfaces.
//
//   Stage 1 — visitCount === 0: just-here, no identity yet
//     → Home shows "Where are you eating?" + recs only
//     → No Wrapped persona reveal (just the preview)
//     → No identity card on Insights
//
//   Stage 2 — visitCount 1-2: light personalization
//     → Recs get a one-line "leaning X" hint above them
//     → Wrapped tab shows a "Your pattern is forming" placeholder
//     → No full identity reveal yet
//
//   Stage 3 — visitCount 3+: full identity
//     → Identity surfaces unlock everywhere
//
// Rule: prove the system before explaining it.
// ============================================================================

import { supabase } from "./supabase";

export type SessionStage = 1 | 2 | 3;

export async function getSessionStage(): Promise<SessionStage> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 1;
  const { count } = await supabase
    .from("visits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  return classifyByVisits(count ?? 0);
}

export function classifyByVisits(visitCount: number): SessionStage {
  if (visitCount === 0) return 1;
  if (visitCount < 3) return 2;
  return 3;
}
