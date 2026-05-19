import { supabase } from "./supabase";
import { getRestaurantIdByPlaceId, type Restaurant } from "./places";
import { track } from "./analytics";
import { triggerHapticSuccess } from "./haptics";

export type Visit = {
  id: string;
  user_id: string;
  restaurant_id: string;
  visited_at: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack" | "unknown";
  detection_source: "auto" | "manual";
  confirmed_by_user: boolean;
  notes: string | null;
  photo_url: string | null;
  restaurant?: Restaurant;
};

function mealTypeFor(date: Date): Visit["meal_type"] {
  const h = date.getHours();
  if (h >= 5 && h < 11) return "breakfast";
  if (h >= 11 && h < 15) return "lunch";
  if (h >= 17 && h < 22) return "dinner";
  return "snack";
}

// Time-of-day buckets per spec. Distinct from `meal_type` (the legacy enum
// column) so Insights can answer "afternoon coffee runs?" / "late-night
// kebab habit?" without ambiguity. Boundaries are inclusive on the start.
export type TimeOfDayBucket =
  | "breakfast"   // 05:00 – 10:59
  | "lunch"       // 11:00 – 14:59
  | "afternoon"   // 15:00 – 16:59
  | "dinner"      // 17:00 – 21:59
  | "lateNight";  // 22:00 – 04:59

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function timeOfDayBucket(date: Date): TimeOfDayBucket {
  const h = date.getHours();
  if (h >= 5 && h < 11) return "breakfast";
  if (h >= 11 && h < 15) return "lunch";
  if (h >= 15 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "dinner";
  return "lateNight";
}

/**
 * Build the canonical time metadata stored on every new visit. All fields are
 * computed in the user's LOCAL timezone — visited_at stays UTC for queries
 * across timezones, the local_* fields preserve "what time it felt like" for
 * the user when Wrapped runs.
 */
export function buildVisitTimeMeta(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const localDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const localTime = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return {
    visited_at: date.toISOString(),
    local_date: localDate,
    local_time: localTime,
    hour_of_day: date.getHours(),
    day_of_week: DOW[date.getDay()],
    time_of_day_bucket: timeOfDayBucket(date),
  };
}

export type SaveVisitResult = Visit & {
  isFirstVisit: boolean;
  totalVisits: number;
};

const VISITS_BEFORE_WRAPPED = 3;

export function visitsToWrapped(currentTotal: number): number {
  return Math.max(0, VISITS_BEFORE_WRAPPED - currentTotal);
}

/** Micro-reward copy for the save toast. */
export function rewardCopy(totalVisits: number): { title: string; message: string } {
  if (totalVisits === 1) {
    return {
      title: "+1 data point",
      message: "We're starting to learn your patterns. Two more visits to unlock your first Weekly Palate.",
    };
  }
  if (totalVisits === 2) {
    return {
      title: "+1 data point",
      message: "One more visit and your first Weekly Palate unlocks.",
    };
  }
  if (totalVisits === VISITS_BEFORE_WRAPPED) {
    return {
      title: "Weekly Palate unlocked 🔓",
      message: "Open the Wrapped tab to see what your week is starting to say.",
    };
  }
  return {
    title: "+1 data point",
    message: "Each visit sharpens your Palate.",
  };
}

// How long after a visit to the same restaurant counts as the "same session"
// rather than a new visit. Stops double-logging when a user taps Save twice
// or auto-detect re-fires within the same meal.
const VISIT_DEDUP_WINDOW_HOURS = 4;

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

  // Dedup: if the user already logged this restaurant within the window,
  // return that existing row instead of creating a duplicate.
  const dedupCutoff = new Date(visitedAt.getTime() - VISIT_DEDUP_WINDOW_HOURS * 3_600_000);
  const { data: existing } = await supabase
    .from("visits")
    .select("*")
    .eq("user_id", user.id)
    .eq("restaurant_id", restaurantId)
    .gte("visited_at", dedupCutoff.toISOString())
    .order("visited_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { count } = await supabase
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    return {
      ...(existing as Visit),
      isFirstVisit: false,
      totalVisits: count ?? 1,
    };
  }

  const { count: priorCount } = await supabase
    .from("visits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  const meta = buildVisitTimeMeta(visitedAt);
  const insertPayload: Record<string, unknown> = {
    user_id: user.id,
    restaurant_id: restaurantId,
    visited_at: meta.visited_at,
    meal_type: mealTypeFor(visitedAt),
    detection_source: opts.source,
    confirmed_by_user: true,
    notes: opts.notes ?? null,
    local_date: meta.local_date,
    local_time: meta.local_time,
    hour_of_day: meta.hour_of_day,
    day_of_week: meta.day_of_week,
    time_of_day_bucket: meta.time_of_day_bucket,
  };

  let { data, error } = await supabase
    .from("visits")
    .insert(insertPayload)
    .select("*")
    .single();

  // Graceful degradation: if the migration hasn't been applied yet, retry
  // without the new columns so the app keeps working in the meantime.
  if (error && /column .* does not exist/i.test(error.message)) {
    const fallback = {
      user_id: insertPayload.user_id,
      restaurant_id: insertPayload.restaurant_id,
      visited_at: insertPayload.visited_at,
      meal_type: insertPayload.meal_type,
      detection_source: insertPayload.detection_source,
      confirmed_by_user: insertPayload.confirmed_by_user,
      notes: insertPayload.notes,
    };
    const retry = await supabase.from("visits").insert(fallback).select("*").single();
    data = retry.data;
    error = retry.error;
  }

  if (error) throw error;
  const total = (priorCount ?? 0) + 1;
  void track("visit_logged", { source: opts.source, visit_total: total });
  void triggerHapticSuccess();
  // Invalidate the personal-signal cache so the next recs / scoring pass sees
  // the new visit (anti-staleness + friend signal stay accurate in real time).
  try { (await import("./personal-signal")).invalidatePersonalSignal(); } catch {}

  // Quietly drop a feed event so friends see "Kenton visited an American spot."
  // No push notification — visit events are passive, not real-time.
  void emitVisitFeedEvent(user.id, restaurantId, opts.googlePlaceId);

  return { ...(data as Visit), isFirstVisit: total === 1, totalVisits: total };
}

async function emitVisitFeedEvent(userId: string, restaurantId: string, googlePlaceId: string) {
  try {
    const { data: rest } = await supabase
      .from("restaurants_resolved")
      .select("name, cuisine_type:resolved_cuisine_type, neighborhood")
      .eq("id", restaurantId)
      .maybeSingle();
    if (!rest) return;
    await supabase.from("feed_events").insert({
      user_id: userId,
      kind: "visit_logged",
      payload: {
        restaurant_name: rest.name,
        cuisine: rest.cuisine_type,
        neighborhood: rest.neighborhood,
        google_place_id: googlePlaceId,
      },
    });
  } catch {
    // silent — feed event is best-effort
  }
}

export async function recentVisits(limit = 20) {
  const { data, error } = await supabase
    .from("visits")
    .select(`
      id, user_id, restaurant_id, visited_at, meal_type, detection_source,
      confirmed_by_user, notes, photo_url,
      restaurant:restaurants ( id, name, chain_name, address, primary_type, google_place_id )
    `)
    .order("visited_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as unknown as Visit[];
}

// ----------------------------------------------------------------------------
// Edit + photo
// ----------------------------------------------------------------------------

export async function updateVisit(
  id: string,
  patch: { googlePlaceId?: string; visitedAt?: Date; notes?: string | null },
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.visitedAt) {
    const meta = buildVisitTimeMeta(patch.visitedAt);
    update.visited_at = meta.visited_at;
    update.meal_type = mealTypeFor(patch.visitedAt);
    update.local_date = meta.local_date;
    update.local_time = meta.local_time;
    update.hour_of_day = meta.hour_of_day;
    update.day_of_week = meta.day_of_week;
    update.time_of_day_bucket = meta.time_of_day_bucket;
  }
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.googlePlaceId) {
    update.restaurant_id = await getRestaurantIdByPlaceId(patch.googlePlaceId);
  }
  if (Object.keys(update).length === 0) return;
  const { error } = await supabase.from("visits").update(update).eq("id", id);
  if (error && /column .* does not exist/i.test(error.message)) {
    // Pre-migration fallback — strip the new fields and retry.
    const legacy: Record<string, unknown> = {};
    for (const k of ["visited_at", "meal_type", "notes", "restaurant_id"]) {
      if (k in update) legacy[k] = update[k];
    }
    if (Object.keys(legacy).length === 0) return;
    const retry = await supabase.from("visits").update(legacy).eq("id", id);
    if (retry.error) throw retry.error;
    return;
  }
  if (error) throw error;
}

export async function attachPhotoToVisit(visitId: string, fileUri: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const ext = (fileUri.split(".").pop() || "jpg").toLowerCase().slice(0, 4);
  const path = `${user.id}/${visitId}-${Date.now()}.${ext}`;

  const resp = await fetch(fileUri);
  const buf = await resp.arrayBuffer();

  const { error: upErr } = await supabase.storage
    .from("visit-photos")
    .upload(path, buf, {
      contentType: ext === "png" ? "image/png" : "image/jpeg",
      upsert: false,
    });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from("visit-photos").getPublicUrl(path);
  const url = pub.publicUrl;

  const { error: updateErr } = await supabase
    .from("visits")
    .update({ photo_url: url })
    .eq("id", visitId);
  if (updateErr) throw updateErr;

  return url;
}

export async function deleteVisit(id: string) {
  const { error } = await supabase.from("visits").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Soft-delete-with-undo: stash the row contents, delete it, return a
 * function that re-creates it. Caller is responsible for showing UI within
 * an undo window.
 */
export async function deleteVisitWithUndo(id: string): Promise<{ undo: () => Promise<void> }> {
  const { data: row, error: fetchErr } = await supabase
    .from("visits")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr || !row) throw fetchErr ?? new Error("Visit not found");

  const { error: delErr } = await supabase.from("visits").delete().eq("id", id);
  if (delErr) throw delErr;

  return {
    undo: async () => {
      const { id: _id, ...rest } = row as Record<string, unknown>;
      // Reinsert with the original id so any references (photos, etc.) still match.
      await supabase.from("visits").insert({ id, ...rest });
    },
  };
}

/** Was the user already prompted for this place recently? Used to suppress
 *  repeats. The "skip_today" outcome — fired by the "Don't ask again today"
 *  button — is honored for a full 24h regardless of `withinMinutes`. */
export async function recentlyPrompted(googlePlaceId: string, withinMinutes = 360) {
  const skipCutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const recentCutoff = new Date(Date.now() - withinMinutes * 60_000).toISOString();
  const { data, error } = await supabase
    .from("prompt_decisions")
    .select("decided_at, outcome")
    .eq("google_place_id", googlePlaceId)
    .gte("decided_at", skipCutoff)
    .order("decided_at", { ascending: false })
    .limit(5);
  if (error) return false;
  const rows = data ?? [];
  if (rows.some((r) => r.outcome === "skip_today")) return true;
  return rows.some((r) => r.decided_at >= recentCutoff);
}

export async function recordPromptDecision(
  googlePlaceId: string,
  outcome: "confirmed" | "dismissed" | "wrong_place" | "ignored" | "skip_today",
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("prompt_decisions").insert({
    user_id: user.id,
    google_place_id: googlePlaceId,
    outcome,
  });
}
