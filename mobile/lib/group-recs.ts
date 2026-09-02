// ============================================================================
// group-recs.ts — client for "best restaurant for everybody".
// ----------------------------------------------------------------------------
// Thin on purpose. All of the ranking, all of the authorization and all of the
// taste data live in the group-recs edge function, because computing this on a
// device would mean holding other people's eating history there.
//
// What comes back is restaurants and scores. Never vectors.
// ============================================================================

import { supabase } from "./supabase";

export type GroupPick = {
  google_place_id: string;
  name: string;
  cuisine: string | null;
  neighborhood: string | null;
  price_level: number | null;
  rating: number | null;
  /** The floor — the least-happy member's score. This is what was maximised. */
  group_score: number;
  per_member: { user_id: string; score: number }[];
};

export type GroupResult = {
  picks: GroupPick[];
  /** How many candidates one member would have hated. */
  vetoed?: number;
  considered?: number;
  /** Members with too little history to score meaningfully. */
  thin_members?: string[];
  /** "no_cached_coverage" | "all_vetoed" | null */
  reason?: string | null;
};

export async function loadGroupRecs(input: {
  memberIds: string[];
  lat: number;
  lng: number;
  radiusM?: number;
}): Promise<GroupResult> {
  const { data, error } = await supabase.functions.invoke("group-recs", {
    body: {
      member_ids: input.memberIds,
      lat: input.lat,
      lng: input.lng,
      radius_m: input.radiusM ?? 3000,
    },
  });
  if (error) throw error;
  return (data ?? { picks: [] }) as GroupResult;
}

/** Copy for the empty cases, so the UI never shows a blank list with no reason. */
export function groupEmptyReason(reason: string | null | undefined): string {
  switch (reason) {
    case "no_cached_coverage":
      return "We haven't explored this area yet. Open Discover here first, then try again.";
    case "all_vetoed":
      return "Nothing nearby works for everyone. Try a wider area or a smaller group.";
    default:
      return "No picks right now.";
  }
}
