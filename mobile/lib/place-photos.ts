// ============================================================================
// place-photos.ts — real photos for the card art slot.
// ----------------------------------------------------------------------------
// PlaceArt draws a cuisine-coloured gradient because licensed photography bills
// per impression. But our own users take photos of their food for free, and
// visits.photo_url has been in the schema the whole time — unused, because
// capture was buried on the visit-detail screen (0 of 47 visits had one).
//
// This resolves a photo per place so the feed can show real pictures where they
// exist and fall back to the gradient where they don't. That is how Beli is
// photo-forward: its users' photos, not a licensing deal.
//
// PREFERENCE ORDER, and it matters:
//   1. the viewer's OWN photo of that place — their memory of it beats a
//      stranger's, and it makes the feed feel like theirs
//   2. anyone else's, most recent first
//
// One batched query per screen, plus a module-level cache, because the naive
// shape here is one query per card.
// ============================================================================

import { supabase } from "./supabase";

/** place_id -> photo url. Null means "asked, and there isn't one" — cached so
 *  a place with no photos doesn't get re-queried on every render. */
const cache = new Map<string, string | null>();

export function cachedPlacePhoto(placeId: string): string | null {
  return cache.get(placeId) ?? null;
}

/**
 * Resolve photos for a set of places in one round trip. Safe to call with ids
 * already cached — those are filtered out before the query.
 */
export async function loadPlacePhotos(placeIds: string[]): Promise<Map<string, string | null>> {
  const unknown = [...new Set(placeIds)].filter((id) => id && !cache.has(id));
  if (unknown.length === 0) return cache;

  try {
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("visits")
      .select("user_id, photo_url, visited_at, restaurant:restaurants!inner(google_place_id)")
      .not("photo_url", "is", null)
      .in("restaurants.google_place_id", unknown)
      .order("visited_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    type Row = {
      user_id: string;
      photo_url: string | null;
      restaurant: { google_place_id?: string } | { google_place_id?: string }[] | null;
    };

    // Rows arrive newest-first. Take the first hit per place, then let the
    // viewer's own photo override it if they have one.
    const mine = new Map<string, string>();
    const theirs = new Map<string, string>();
    for (const row of (data ?? []) as Row[]) {
      const r = row.restaurant;
      const gid = Array.isArray(r) ? r[0]?.google_place_id : r?.google_place_id;
      if (!gid || !row.photo_url) continue;
      const bucket = user && row.user_id === user.id ? mine : theirs;
      if (!bucket.has(gid)) bucket.set(gid, row.photo_url);
    }

    for (const id of unknown) {
      cache.set(id, mine.get(id) ?? theirs.get(id) ?? null);
    }
  } catch {
    // A failed lookup must not blank the feed — mark them as "no photo" for
    // this session and let the gradient carry the cards.
    for (const id of unknown) if (!cache.has(id)) cache.set(id, null);
  }

  return cache;
}

/** Drop a place from the cache so a freshly-added photo shows immediately. */
export function invalidatePlacePhoto(placeId: string): void {
  cache.delete(placeId);
}
