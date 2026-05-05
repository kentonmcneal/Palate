// ============================================================================
// featured-lists-refresh — pre-computes Featured Lists per city.
// ----------------------------------------------------------------------------
// Triggered by:
//   • Nightly pg_cron (refresh every active city)
//   • Lazy on-demand from the mobile client (when a user opens Discover in
//     a city that has no cache yet, or whose cache is stale)
//
// For each (city, category) we hit Google Places Text Search ONCE with the
// category's search query ("burgers in Philadelphia, PA") — returns up to
// 20 results. We sort by quality + popularity and persist the top N to the
// featured_lists_cache table.
//
// Body shapes:
//   { action: "refresh_city", city_key, city_label, lat, lng }
//   { action: "refresh_all_active" }   — used by cron
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_KEY   = Deno.env.get("GOOGLE_PLACES_API_KEY")!;

const TOP_N = 10;
const STALE_AFTER_MS = 36 * 60 * 60 * 1000; // 36h

// ----------------------------------------------------------------------------
// Categories — must stay in sync with the mobile client's CATEGORIES list.
// Each entry has a Google Places Text Search query that pulls real category
// results.
// ----------------------------------------------------------------------------
type Category = {
  slug: string;
  title: string;
  // {city} is interpolated to the city label
  query: string;
};

const CATEGORIES: Category[] = [
  { slug: "date-night",    title: "Top 10 Date Night",   query: "best date night restaurants in {city}" },
  { slug: "late-night",    title: "Top 10 Late Night",   query: "late night food in {city}" },
  { slug: "early-morning", title: "Top 10 Early Morning", query: "best breakfast in {city}" },
  { slug: "brunch",        title: "Top 10 Brunch",       query: "best brunch in {city}" },
  { slug: "burgers",       title: "Top 10 Burgers",      query: "best burgers in {city}" },
  { slug: "wings",         title: "Top 10 Wings",        query: "best wings in {city}" },
  { slug: "fries",         title: "Top 10 Fries",        query: "best french fries in {city}" },
  { slug: "hummus",        title: "Top 10 Hummus",       query: "best hummus in {city}" },
  { slug: "steaks",        title: "Top 10 Steaks",       query: "best steakhouse in {city}" },
  { slug: "pizza",         title: "Top 10 Pizza",        query: "best pizza in {city}" },
  { slug: "tacos",         title: "Top 10 Tacos",        query: "best tacos in {city}" },
  { slug: "sushi",         title: "Top 10 Sushi",        query: "best sushi in {city}" },
  { slug: "bbq",           title: "Top 10 BBQ",          query: "best bbq in {city}" },
  { slug: "american",      title: "Top 10 American",     query: "best american restaurants in {city}" },
  { slug: "italian",       title: "Top 10 Italian",      query: "best italian restaurants in {city}" },
  { slug: "caribbean",     title: "Top 10 Caribbean",    query: "best caribbean restaurants in {city}" },
  { slug: "cafes",         title: "Top Cafés",           query: "best coffee shop in {city}" },
];

// ----------------------------------------------------------------------------
// Handler
// ----------------------------------------------------------------------------
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });
  }
  const body = await req.json().catch(() => ({}));
  const action = body.action as string | undefined;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    if (action === "refresh_city") {
      const { city_key, city_label, lat, lng } = body as {
        city_key: string; city_label: string; lat: number; lng: number;
      };
      if (!city_key || !city_label || lat == null || lng == null) {
        return json({ error: "missing_params" }, 400);
      }
      const result = await refreshCity(admin, city_key, city_label, lat, lng);
      return json({ ok: true, ...result });
    }

    if (action === "refresh_all_active") {
      const { data: cities, error } = await admin
        .from("featured_lists_active_cities")
        .select("city_key, city_label, city_lat, city_lng")
        // Only refresh cities seen in the last 14 days
        .gte("last_seen_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString());
      if (error) throw error;

      const results = [];
      for (const c of cities ?? []) {
        try {
          const r = await refreshCity(admin, c.city_key, c.city_label, c.city_lat, c.city_lng);
          results.push({ city: c.city_key, ...r });
        } catch (e) {
          results.push({ city: c.city_key, error: String(e) });
        }
      }
      return json({ ok: true, refreshed: results.length, results });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("featured-lists-refresh failed", e);
    return json({ error: "internal", detail: String(e) }, 500);
  }
});

// ----------------------------------------------------------------------------
// Refresh a single city — runs all category Text Searches in sequence,
// upserts results into the cache.
// ----------------------------------------------------------------------------
async function refreshCity(
  admin: ReturnType<typeof createClient>,
  city_key: string,
  city_label: string,
  lat: number,
  lng: number,
): Promise<{ categories_refreshed: number; total_restaurants: number }> {
  // Skip if already fresh (avoid hammering Google when the cron runs and a
  // city was just lazy-refreshed by a user).
  const { data: existing } = await admin
    .from("featured_lists_cache")
    .select("refreshed_at")
    .eq("city_key", city_key)
    .order("refreshed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && Date.now() - new Date(existing.refreshed_at).getTime() < STALE_AFTER_MS / 2) {
    // Already refreshed within the last 18 hours — skip.
    return { categories_refreshed: 0, total_restaurants: 0 };
  }

  let categoriesRefreshed = 0;
  let totalRestaurants = 0;

  for (const cat of CATEGORIES) {
    const query = cat.query.replace("{city}", city_label);
    try {
      const places = await googleTextSearch(query, lat, lng);
      if (places.length === 0) continue;

      const ranked = rankAndTrim(places, lat, lng).slice(0, TOP_N);

      await admin
        .from("featured_lists_cache")
        .upsert({
          city_key,
          city_label,
          city_lat: lat,
          city_lng: lng,
          category_slug: cat.slug,
          category_title: cat.title,
          restaurants: ranked,
          refreshed_at: new Date().toISOString(),
        }, { onConflict: "city_key,category_slug" });

      categoriesRefreshed++;
      totalRestaurants += ranked.length;
    } catch (e) {
      console.warn(`refresh failed for ${city_key}/${cat.slug}`, e);
      // continue with other categories
    }
  }

  return { categories_refreshed: categoriesRefreshed, total_restaurants: totalRestaurants };
}

// ----------------------------------------------------------------------------
// Google Places Text Search v1
// ----------------------------------------------------------------------------
type GooglePlace = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: { latitude: number; longitude: number };
  primaryType?: string;
  types?: string[];
  priceLevel?: string;
  rating?: number;
  userRatingCount?: number;
};

async function googleTextSearch(
  query: string,
  lat: number,
  lng: number,
): Promise<GooglePlace[]> {
  const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.location,places.primaryType,places.types,places.priceLevel,places.rating,places.userRatingCount",
    },
    body: JSON.stringify({
      textQuery: query,
      pageSize: 20,
      // bias to the city's coords (results outside the 30km radius are dropped)
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 30000,
        },
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`google text search ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  return (data.places ?? []) as GooglePlace[];
}

// ----------------------------------------------------------------------------
// Ranking + serialization
// ----------------------------------------------------------------------------
function rankAndTrim(places: GooglePlace[], cityLat: number, cityLng: number) {
  // Composite: 0.4 quality + 0.4 popularity + 0.2 proximity to city center.
  const maxLogReviews = Math.max(
    ...places.map((p) => Math.log10(1 + (p.userRatingCount ?? 0))),
    1,
  );
  return places
    .map((p) => {
      const popularity = Math.log10(1 + (p.userRatingCount ?? 0)) / maxLogReviews;
      const rating = p.rating ?? 0;
      const quality = rating >= 3.0 ? Math.min(1, (rating - 3.0) / 2.0) : 0;
      let prox = 1;
      if (p.location) {
        const km = haversineKm(cityLat, cityLng, p.location.latitude, p.location.longitude);
        prox = Math.max(0, 1 - km / 15);
      }
      const composite = 0.4 * quality + 0.4 * popularity + 0.2 * prox;
      return { p, composite };
    })
    .sort((a, b) => b.composite - a.composite)
    .map(({ p }) => ({
      google_place_id: p.id,
      name: p.displayName?.text ?? "",
      cuisine_type: p.primaryType ?? null,
      neighborhood: shortHood(p.shortFormattedAddress, p.formattedAddress),
      price_level: googlePriceLevelToInt(p.priceLevel),
      rating: p.rating ?? null,
      user_rating_count: p.userRatingCount ?? null,
      latitude: p.location?.latitude ?? null,
      longitude: p.location?.longitude ?? null,
    }));
}

function shortHood(short?: string, full?: string): string | null {
  // Best-effort: extract neighborhood / first locality from the address
  const src = short || full;
  if (!src) return null;
  const parts = src.split(",").map((s) => s.trim());
  return parts[0] || null;
}

function googlePriceLevelToInt(g?: string): number | null {
  // Google v1 returns enum strings; map to the 1..4 ints the app expects.
  if (!g) return null;
  if (g === "PRICE_LEVEL_FREE" || g === "PRICE_LEVEL_INEXPENSIVE") return 1;
  if (g === "PRICE_LEVEL_MODERATE") return 2;
  if (g === "PRICE_LEVEL_EXPENSIVE") return 3;
  if (g === "PRICE_LEVEL_VERY_EXPENSIVE") return 4;
  return null;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
