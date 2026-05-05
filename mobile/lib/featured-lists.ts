// ============================================================================
// featured-lists.ts — reads city-level Featured Lists from the cache table.
// ----------------------------------------------------------------------------
// Architecture (per cost discussion):
//   • Cache table `featured_lists_cache` holds (city, category) → top 10
//   • Edge function `featured-lists-refresh` populates the cache via Google
//     Places Text Search (one query per category, up to 20 results each)
//   • Nightly cron refreshes every active city
//   • This file:
//       - reads from the cache for the current city
//       - marks the city as "active" so the cron knows to refresh it
//       - if the cache is missing for this city, triggers a one-shot refresh
//   • Cost: zero per user — a city's cache is computed once per day, served
//     to every user in that city from a Supabase row read
// ============================================================================

import { supabase } from "./supabase";
import type { RestaurantInput } from "./recommendation";

export type FeaturedList = {
  slug: string;
  title: string;                 // "Top 10 Burgers"
  subtitle: string;              // "in Philadelphia"
  visitedCount: number;          // user-specific overlay computed client-side
  totalCount: number;
  gradient: [string, string];
  iconGlyph: string;
  restaurants: RestaurantInput[];
};

// ----------------------------------------------------------------------------
// Per-category visual metadata. Lives client-side so we don't store gradient
// hex codes in postgres. Slugs MUST match what the edge function writes.
// ----------------------------------------------------------------------------
type CategoryMeta = {
  slug: string;
  gradient: [string, string];
  iconGlyph: string;
};

const CATEGORY_META: CategoryMeta[] = [
  { slug: "date-night",    gradient: ["#7E1538", "#280008"], iconGlyph: "D" },
  { slug: "late-night",    gradient: ["#0F1A2E", "#000408"], iconGlyph: "L" },
  { slug: "early-morning", gradient: ["#FFB347", "#7A4400"], iconGlyph: "M" },
  { slug: "brunch",        gradient: ["#F4A26A", "#7B2D00"], iconGlyph: "U" },
  { slug: "burgers",       gradient: ["#FF3008", "#7A0B00"], iconGlyph: "B" },
  { slug: "wings",         gradient: ["#FF8C00", "#5A1E00"], iconGlyph: "W" },
  { slug: "fries",         gradient: ["#FFC04D", "#6B4500"], iconGlyph: "F" },
  { slug: "hummus",        gradient: ["#A89052", "#3D2F0E"], iconGlyph: "H" },
  { slug: "steaks",        gradient: ["#2B0A0A", "#000000"], iconGlyph: "K" },
  { slug: "pizza",         gradient: ["#FF6B45", "#9C2200"], iconGlyph: "P" },
  { slug: "tacos",         gradient: ["#FF8C42", "#7B2D00"], iconGlyph: "T" },
  { slug: "sushi",         gradient: ["#1F1F1F", "#000000"], iconGlyph: "S" },
  { slug: "bbq",           gradient: ["#5C1F00", "#1B0700"], iconGlyph: "Q" },
  { slug: "american",      gradient: ["#3D5A80", "#0E1F36"], iconGlyph: "A" },
  { slug: "italian",       gradient: ["#7C2D12", "#1F0904"], iconGlyph: "I" },
  { slug: "caribbean",     gradient: ["#0D8A6B", "#022B22"], iconGlyph: "R" },
  { slug: "cafes",         gradient: ["#8C5B36", "#3A1D0A"], iconGlyph: "C" },
];
const META_BY_SLUG = new Map(CATEGORY_META.map((m) => [m.slug, m]));

// ----------------------------------------------------------------------------
// Module cache so the detail screen can render without a fresh fetch.
// ----------------------------------------------------------------------------
let cacheCityKey: string | null = null;
const cache = new Map<string, FeaturedList>();

export function getCachedFeaturedList(slug: string): FeaturedList | null {
  return cache.get(slug) ?? null;
}

// ----------------------------------------------------------------------------
// Public entry — reads the city's cached lists, marks the city active,
// triggers a refresh if the cache is empty.
// ----------------------------------------------------------------------------
export async function buildFeaturedLists(opts: {
  here: { lat: number; lng: number };
  city?: string | null;
  // These two are accepted for API compat but no longer used — the cache is
  // city-level, not user-level.
  vector?: unknown;
  personal?: unknown;
}): Promise<FeaturedList[]> {
  const cityKey = opts.city ? slugify(opts.city) : `gps:${opts.here.lat.toFixed(2)},${opts.here.lng.toFixed(2)}`;
  const cityLabel = opts.city ?? "Nearby";
  const subtitle = opts.city ? `in ${opts.city}` : "Nearby";

  // 1. Mark this city as active so the nightly cron knows to refresh it.
  //    Fire and forget — failure is non-critical.
  void (async () => {
    try {
      await supabase.rpc("featured_lists_mark_city_active", {
        p_city_key: cityKey,
        p_city_label: cityLabel,
        p_lat: opts.here.lat,
        p_lng: opts.here.lng,
      });
    } catch { /* ignore */ }
  })();

  // 2. Read the cache for this city.
  const { data: rows } = await supabase
    .from("featured_lists_for_city")
    .select("category_slug, category_title, restaurants, refreshed_at, is_fresh")
    .eq("city_key", cityKey);

  // 3. If cache is empty, kick off a one-shot refresh and return empty for now
  //    (the user will see content on the next Discover open). This keeps the
  //    UI from blocking on a multi-second Google round-trip.
  if (!rows || rows.length === 0) {
    void supabase.functions.invoke("featured-lists-refresh", {
      body: {
        action: "refresh_city",
        city_key: cityKey,
        city_label: cityLabel,
        lat: opts.here.lat,
        lng: opts.here.lng,
      },
    }).catch(() => {});
    cacheCityKey = cityKey;
    cache.clear();
    return [];
  }

  // 4. If any rows are stale, kick off a background refresh while still
  //    serving the stale data. (Stale-while-revalidate.)
  const anyStale = rows.some((r: any) => !r.is_fresh);
  if (anyStale) {
    void supabase.functions.invoke("featured-lists-refresh", {
      body: {
        action: "refresh_city",
        city_key: cityKey,
        city_label: cityLabel,
        lat: opts.here.lat,
        lng: opts.here.lng,
      },
    }).catch(() => {});
  }

  // 5. Hydrate the user's visited place IDs to compute the "X of 10" overlay.
  const visitedIds = await loadUserVisitedIds();

  // 6. Map cache rows → FeaturedList[]
  const lists: FeaturedList[] = [];
  for (const row of rows as any[]) {
    const meta = META_BY_SLUG.get(row.category_slug);
    if (!meta) continue;
    const restaurants = (row.restaurants ?? []) as RestaurantInput[];
    const visited = restaurants.filter((r) => visitedIds.has(r.google_place_id)).length;
    lists.push({
      slug: row.category_slug,
      title: row.category_title,
      subtitle,
      visitedCount: visited,
      totalCount: restaurants.length,
      gradient: meta.gradient,
      iconGlyph: meta.iconGlyph,
      restaurants,
    });
  }

  // Refresh module cache for the detail screen.
  if (cacheCityKey !== cityKey) {
    cache.clear();
    cacheCityKey = cityKey;
  }
  for (const l of lists) cache.set(l.slug, l);

  return lists;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function loadUserVisitedIds(): Promise<Set<string>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data } = await supabase
    .from("visits")
    .select("restaurant:restaurants!inner(google_place_id)")
    .eq("user_id", user.id);
  const out = new Set<string>();
  for (const row of (data ?? []) as any[]) {
    const r = Array.isArray(row.restaurant) ? row.restaurant[0] : row.restaurant;
    if (r?.google_place_id) out.add(r.google_place_id);
  }
  return out;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
