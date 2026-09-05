// ============================================================================
// dislikes.ts — "Not interested", and what it teaches.
// ----------------------------------------------------------------------------
// Two jobs, kept apart:
//
//   1. EXCLUSION. A place you said no to is gone from every recommendation
//      surface for you, permanently, until you restore it in Settings. That
//      is a set membership test, and it happens before ranking.
//
//   2. LEARNING. The reason you gave decides what the app learns. "Not into
//      this food" counts against the cuisine, the subregion and the dish
//      families; "too pricey" against the price tier; "wrong vibe" against
//      the format. "Just this place" is a light nudge against all of them.
//      Counts saturate — the first no is a small lesson, the fifth is a big
//      one — and a lesson is dampened by how much you have actually eaten of
//      that thing, so a single dismissed taqueria cannot outweigh forty taco
//      visits.
//
// The penalty is a pure function of (profile, restaurant) so it is testable
// and the same on every surface.
// ============================================================================

import { supabase } from "./supabase";

export type DislikeReason = "place" | "food" | "price" | "vibe";

export type DislikeRow = {
  google_place_id: string;
  reason: DislikeReason;
  cuisine_type: string | null;
  cuisine_subregion: string | null;
  format_class: string | null;
  dish_family: string[] | null;
  price_level: number | null;
  neighborhood: string | null;
  created_at: string;
  restaurant_name?: string | null;
};

export type DislikeProfile = {
  placeIds: Set<string>;
  cuisines: Record<string, number>;
  subregions: Record<string, number>;
  formats: Record<string, number>;
  dishes: Record<string, number>;
  priceTiers: Record<string, number>;
  neighborhoods: Record<string, number>;
};

export const EMPTY_DISLIKES: DislikeProfile = {
  placeIds: new Set(),
  cuisines: {}, subregions: {}, formats: {}, dishes: {}, priceTiers: {}, neighborhoods: {},
};

// How much each reason teaches about each attribute. A reason that names the
// thing counts fully; the others count a little, because a person who says
// "just this place" three times about steakhouses is telling you something.
const REASON_WEIGHT: Record<DislikeReason, Record<keyof Omit<DislikeProfile, "placeIds">, number>> = {
  place: { cuisines: 0.35, subregions: 0.35, formats: 0.25, dishes: 0.35, priceTiers: 0.15, neighborhoods: 0.1 },
  food:  { cuisines: 1.0,  subregions: 1.2,  formats: 0.1,  dishes: 1.0,  priceTiers: 0.0,  neighborhoods: 0.0 },
  price: { cuisines: 0.1,  subregions: 0.1,  formats: 0.2,  dishes: 0.0,  priceTiers: 1.2,  neighborhoods: 0.0 },
  vibe:  { cuisines: 0.1,  subregions: 0.1,  formats: 1.2,  dishes: 0.1,  priceTiers: 0.2,  neighborhoods: 0.2 },
};

function bump(map: Record<string, number>, key: string | null | undefined, by: number) {
  if (!key || by <= 0) return;
  const k = key.toLowerCase().trim();
  if (!k) return;
  map[k] = (map[k] ?? 0) + by;
}

/** Fold the rows into weighted counts per attribute. Pure. */
export function buildDislikeProfile(rows: DislikeRow[]): DislikeProfile {
  const p: DislikeProfile = {
    placeIds: new Set(), cuisines: {}, subregions: {}, formats: {}, dishes: {}, priceTiers: {}, neighborhoods: {},
  };
  for (const r of rows) {
    p.placeIds.add(r.google_place_id);
    const w = REASON_WEIGHT[r.reason] ?? REASON_WEIGHT.place;
    bump(p.cuisines, r.cuisine_type, w.cuisines);
    bump(p.subregions, r.cuisine_subregion, w.subregions);
    bump(p.formats, r.format_class, w.formats);
    for (const d of r.dish_family ?? []) bump(p.dishes, d, w.dishes);
    if (r.price_level != null) bump(p.priceTiers, String(r.price_level), w.priceTiers);
    bump(p.neighborhoods, r.neighborhood, w.neighborhoods);
  }
  return p;
}

/** count/(count+k): 1 → 0.33, 2 → 0.5, 5 → 0.71, never 1. */
function saturate(n: number, k = 2): number {
  return n > 0 ? n / (n + k) : 0;
}

export type DislikeCandidate = {
  google_place_id: string;
  cuisine_type?: string | null;
  cuisine_subregion?: string | null;
  format_class?: string | null;
  dish_family?: string[] | null;
  price_level?: number | null;
  neighborhood?: string | null;
};

/** Points to subtract from a 0..100 score. 0 when nothing applies. Pure.
 *
 *  `positiveVisits` is how many times the person has eaten this candidate's
 *  cuisine; it dampens the lesson so evidence of liking something is not
 *  erased by one no. */
export function dislikePenalty(
  profile: DislikeProfile,
  r: DislikeCandidate,
  positiveVisits = 0,
): number {
  if (profile.placeIds.size === 0) return 0;
  const key = (s: string | null | undefined) => (s ?? "").toLowerCase().trim();

  let pts = 0;
  pts += 14 * saturate(profile.cuisines[key(r.cuisine_type)] ?? 0);
  pts += 10 * saturate(profile.subregions[key(r.cuisine_subregion)] ?? 0);
  pts += 8 * saturate(profile.formats[key(r.format_class)] ?? 0);
  let dishMax = 0;
  for (const d of r.dish_family ?? []) dishMax = Math.max(dishMax, profile.dishes[key(d)] ?? 0);
  pts += 10 * saturate(dishMax);
  if (r.price_level != null) pts += 6 * saturate(profile.priceTiers[String(r.price_level)] ?? 0);
  pts += 3 * saturate(profile.neighborhoods[key(r.neighborhood)] ?? 0);

  // Forty taco visits versus one dismissed taqueria: the visits win.
  const damp = 1 / (1 + positiveVisits / 5);
  return Math.round(Math.min(30, pts * damp));
}

// ----------------------------------------------------------------------------
// Data access
// ----------------------------------------------------------------------------

export async function listDislikes(): Promise<DislikeRow[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("place_dislikes")
    .select("google_place_id, reason, cuisine_type, cuisine_subregion, format_class, dish_family, price_level, neighborhood, created_at, restaurant:restaurants(name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    ...r,
    restaurant_name: Array.isArray(r.restaurant) ? r.restaurant[0]?.name : r.restaurant?.name ?? null,
  })) as DislikeRow[];
}

export async function dislikePlace(googlePlaceId: string, reason: DislikeReason): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("place_dislikes")
    .upsert({ user_id: user.id, google_place_id: googlePlaceId, reason }, { onConflict: "user_id,google_place_id" });
  if (error) throw error;
}

export async function restorePlace(googlePlaceId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from("place_dislikes")
    .delete()
    .eq("user_id", user.id)
    .eq("google_place_id", googlePlaceId);
  if (error) throw error;
}

export const REASON_LABEL: Record<DislikeReason, string> = {
  place: "Just this place",
  food: "Not into this kind of food",
  price: "Too pricey",
  vibe: "Wrong kind of place",
};
