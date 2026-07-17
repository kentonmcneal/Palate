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
import {
  type GooglePlace as ClassifierPlace,
  googleToRestaurantRow,
} from "../_shared/classifier.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_KEY   = Deno.env.get("GOOGLE_PLACES_API_KEY")!;
// Shared secret the pg_cron job must send (x-cron-secret) to run refresh_all_active.
const CRON_SECRET  = Deno.env.get("CRON_SECRET") ?? "";

const TOP_N = 10;
// Google text search returns 20 results/page. Only paginate (up to 3 pages /
// 60 raw) when a list is short of TOP_N after filtering — well-covered
// categories cost a single call, so the extra Google spend is bounded to lists
// that actually under-fill. NB: this cron calls Google directly, outside
// places-proxy's daily kill-switch, so keeping pagination conditional matters.
const MAX_PAGES = 3;
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

  // --- Authorization ------------------------------------------------------
  // This function calls Google Places Text Search directly, OUTSIDE the
  // places-proxy daily kill-switch, so it must NEVER run for an unauthenticated
  // caller (the public anon key satisfies the gateway but is NOT a user token).
  //   • refresh_all_active — cron only: requires the CRON_SECRET header.
  //   • refresh_city       — requires a signed-in user.
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (action === "refresh_all_active") {
    if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
      return json({ error: "unauthorized" }, 401);
    }
  } else if (action === "refresh_city") {
    const { data: { user } } = await admin.auth.getUser(bearer);
    if (!user) return json({ error: "unauthorized" }, 401);
  } else {
    return json({ error: "unknown_action" }, 400);
  }

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
      // Collect candidates across up to MAX_PAGES pages, stopping as soon as we
      // have enough eligible + hours-passing places to fill the list. Chains,
      // airports, hotels, lounges (recommendation_eligibility === 0) are dropped
      // below, so a chain-heavy category like "burgers" often needs page 2/3 to
      // reach TOP_N genuine independents. Well-covered categories break after
      // one page, so the extra spend is bounded to lists that are actually short.
      const rawById = new Map<string, GooglePlace>();
      let pageToken: string | undefined = undefined;
      let eligibleRows: ClassifiedRow[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const { places, nextPageToken } = await googleTextSearch(query, lat, lng, pageToken);
        for (const p of places) rawById.set(p.id, p);

        // Per-category time-of-day filter (late-night must be open late, etc.),
        // then classify and drop ineligible venues. Re-run over everything
        // collected so far so the stop condition sees the full pool. Classifying
        // is deterministic and LLM-free here, so re-running per page is cheap.
        const hoursFiltered = filterByCategorySlug([...rawById.values()], cat.slug);
        const classified = hoursFiltered.map((p) =>
          googleToRestaurantRow(p as unknown as ClassifierPlace),
        );
        eligibleRows = classified.filter(
          (row) => (row.recommendation_eligibility ?? 1) > 0,
        );

        if (eligibleRows.length >= TOP_N || !nextPageToken) break;
        pageToken = nextPageToken;
      }
      if (eligibleRows.length === 0) continue;

      // Side-effect: keep `restaurants` warm with the full classified row.
      // Stripping google_raw to keep upsert payload reasonable.
      const restaurantRows = eligibleRows.map(({ google_raw: _r, ...rest }) => rest);
      void admin.from("restaurants").upsert(restaurantRows, {
        onConflict: "google_place_id",
      });

      const ranked = rankAndTrimClassified(eligibleRows, lat, lng).slice(0, TOP_N);

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
  pageToken?: string,
): Promise<{ places: GooglePlace[]; nextPageToken?: string }> {
  const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask":
        // regularOpeningHours added so we can filter by time-of-day per
        // category (late-night needs to actually be open late, etc.);
        // nextPageToken so we can paginate short lists up to TOP_N.
        "nextPageToken,places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.location,places.primaryType,places.types,places.priceLevel,places.rating,places.userRatingCount,places.regularOpeningHours",
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
      // pageToken must accompany otherwise-identical params (Google requirement).
      ...(pageToken ? { pageToken } : {}),
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`google text search ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  return {
    places: (data.places ?? []) as GooglePlace[],
    nextPageToken: data.nextPageToken as string | undefined,
  };
}

// ----------------------------------------------------------------------------
// Hours-based filtering — Google's text-search ranking doesn't consider
// actual operating hours, so a "late night food" search returns places that
// close at 10:30 PM. We post-filter per category.
// ----------------------------------------------------------------------------
type Period = {
  open?: { day?: number; hour?: number; minute?: number };
  close?: { day?: number; hour?: number; minute?: number };
};

function getPeriods(p: GooglePlace): Period[] {
  return (p as any).regularOpeningHours?.periods ?? [];
}

/** True iff the place is open past 23:00 on at least one Fri/Sat night,
 *  or has an overnight close (close.day != open.day) on those nights. */
function isOpenLate(p: GooglePlace): boolean {
  const periods = getPeriods(p);
  if (periods.length === 0) return true; // Missing data — don't filter aggressively
  for (const period of periods) {
    const openDay = period.open?.day;
    if (openDay !== 4 && openDay !== 5 && openDay !== 6) continue; // Thu/Fri/Sat
    const closeHour = period.close?.hour ?? 0;
    const closeDay = period.close?.day;
    // Overnight close (closes the next morning) → always counts as late.
    if (closeDay != null && openDay != null && closeDay !== openDay) return true;
    // Same-day close at 23:00 or later
    if (closeHour >= 23 || (closeHour === 0 && (period.close?.minute ?? 0) > 0)) return true;
  }
  return false;
}

/** True iff the place is open at or before 8:00 on at least one weekday. */
function isOpenEarly(p: GooglePlace): boolean {
  const periods = getPeriods(p);
  if (periods.length === 0) return true;
  for (const period of periods) {
    const openDay = period.open?.day;
    if (openDay == null || openDay === 0 || openDay === 6) continue; // weekdays only
    const openHour = period.open?.hour ?? 23;
    if (openHour <= 8) return true;
  }
  return false;
}

/** True iff the place opens between 9:00-13:00 on Sat or Sun. */
function isOpenForBrunch(p: GooglePlace): boolean {
  const periods = getPeriods(p);
  if (periods.length === 0) return true;
  for (const period of periods) {
    const openDay = period.open?.day;
    if (openDay !== 0 && openDay !== 6) continue; // Sun or Sat
    const openHour = period.open?.hour ?? 23;
    if (openHour >= 9 && openHour <= 13) return true;
  }
  return false;
}

function filterByCategorySlug(places: GooglePlace[], slug: string): GooglePlace[] {
  switch (slug) {
    case "late-night":    return places.filter(isOpenLate);
    case "early-morning": return places.filter(isOpenEarly);
    case "brunch":        return places.filter(isOpenForBrunch);
    default:              return places;
  }
}

// ----------------------------------------------------------------------------
// Ranking — takes already-classified rows (from googleToRestaurantRow) and
// projects them into the trimmed shape the mobile cache reader expects.
// Composite: 0.4 quality + 0.4 popularity + 0.2 proximity to city center.
// ----------------------------------------------------------------------------
type ClassifiedRow = ReturnType<typeof googleToRestaurantRow>;

function rankAndTrimClassified(rows: ClassifiedRow[], cityLat: number, cityLng: number) {
  const maxLogReviews = Math.max(
    ...rows.map((r) => Math.log10(1 + (r.user_rating_count ?? 0))),
    1,
  );
  return rows
    .map((r) => {
      const popularity = Math.log10(1 + (r.user_rating_count ?? 0)) / maxLogReviews;
      const rating = r.rating ?? 0;
      const quality = rating >= 3.0 ? Math.min(1, (rating - 3.0) / 2.0) : 0;
      let prox = 1;
      if (r.latitude != null && r.longitude != null) {
        const km = haversineKm(cityLat, cityLng, r.latitude, r.longitude);
        prox = Math.max(0, 1 - km / 15);
      }
      const composite = 0.4 * quality + 0.4 * popularity + 0.2 * prox;
      return { r, composite };
    })
    .sort((a, b) => b.composite - a.composite)
    .map(({ r }) => ({
      google_place_id: r.google_place_id,
      name: r.name,
      cuisine_type: r.cuisine_type,
      neighborhood: r.neighborhood,
      price_level: r.price_level,
      rating: r.rating,
      user_rating_count: r.user_rating_count,
      latitude: r.latitude,
      longitude: r.longitude,
      // Carried into the cache so the mobile safety-net filter no-ops
      // (cache rows are pre-filtered, but the field stays accurate).
      recommendation_eligibility: r.recommendation_eligibility,
    }));
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
