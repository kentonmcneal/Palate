import { supabase } from "./supabase";
import { getRestaurantIdByPlaceId, type Restaurant } from "./places";

export type Visit = {
  id: string;
  user_id: string;
  restaurant_id: string;
  visited_at: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack" | "unknown";
  detection_source: "auto" | "manual";
  confirmed_by_user: boolean;
  notes: string | null;
  restaurant?: Restaurant;
};

function mealTypeFor(date: Date): Visit["meal_type"] {
  const h = date.getHours();
  if (h >= 5 && h < 11) return "breakfast";
  if (h >= 11 && h < 15) return "lunch";
  if (h >= 17 && h < 22) return "dinner";
  return "snack";
}

export type SaveVisitResult = Visit & { isFirstVisit: boolean };

export async function saveVisit(opts: {
  googlePlaceId: string;
  visitedAt?: Date;
  source: "auto" | "manual";
  notes?: string;
}): Promise<SaveVisitResult> {
  const restaurantId = await getRestaurantIdByPlaceId(opts.googlePlaceId);
  const visitedAt = opts.visitedAt ?? new Date();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  // Cheap pre-insert count so the caller can show the first-visit celebration.
  // Done before insert so we don't double-count the new row.
  const { count: priorCount } = await supabase
    .from("visits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  const { data, error } = await supabase
    .from("visits")
    .insert({
      user_id: user.id,
      restaurant_id: restaurantId,
      visited_at: visitedAt.toISOString(),
      meal_type: mealTypeFor(visitedAt),
      detection_source: opts.source,
      confirmed_by_user: true,
      notes: opts.notes ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return { ...(data as Visit), isFirstVisit: (priorCount ?? 0) === 0 };
}

export async function recentVisits(limit = 20) {
  const { data, error } = await supabase
    .from("visits")
    .select(`
      id, user_id, restaurant_id, visited_at, meal_type, detection_source,
      confirmed_by_user, notes,
      restaurant:restaurants ( id, name, chain_name, address, primary_type, google_place_id )
    `)
    .order("visited_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as unknown as Visit[];
}

export async function deleteVisit(id: string) {
  const { error } = await supabase.from("visits").delete().eq("id", id);
  if (error) throw error;
}

/** Was the user already prompted for this place recently? Used to suppress repeats. */
export async function recentlyPrompted(googlePlaceId: string, withinMinutes = 360) {
  const cutoff = new Date(Date.now() - withinMinutes * 60_000).toISOString();
  const { data, error } = await supabase
    .from("prompt_decisions")
    .select("id")
    .eq("google_place_id", googlePlaceId)
    .gte("decided_at", cutoff)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

export async function recordPromptDecision(
  googlePlaceId: string,
  outcome: "confirmed" | "dismissed" | "wrong_place" | "ignored",
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("prompt_decisions").insert({
    user_id: user.id,
    google_place_id: googlePlaceId,
    outcome,
  });
}
