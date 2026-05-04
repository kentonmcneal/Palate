// ============================================================================
// featured-lists.ts — Beli-style "Top 10 X" curated lists.
// ----------------------------------------------------------------------------
// Each list is a category cut against the user's nearby restaurants. Cover
// is a gradient pair per cuisine (no photos in the catalog yet). Progress
// counts how many of the top 10 the user has visited.
//
// We keep a module-level cache so the detail screen can render without
// re-fetching (and without trying to round-trip a 10-restaurant payload
// through expo-router params, which crashed on iOS due to URL-length limits).
// ============================================================================

import { supabase } from "./supabase";
import { nearbyRestaurants, type Restaurant } from "./places";
import { calculatePalateMatchScore, type RestaurantInput } from "./palate-match-score";
import type { TasteVector } from "./taste-vector";
import type { PersonalSignal } from "./personal-signal";
import { distanceKm } from "./match-score";

export type FeaturedList = {
  slug: string;
  title: string;                 // "Top 10 Burgers"
  subtitle: string;              // "in Philadelphia" / "Nearby"
  visitedCount: number;
  totalCount: number;
  gradient: [string, string];    // [from, to]
  iconGlyph: string;             // single character glyph for the corner badge
  restaurants: RestaurantInput[];
};

type CategoryDef = {
  slug: string;
  title: string;
  gradient: [string, string];
  iconGlyph: string;
  match: (r: Restaurant) => boolean;
};

// Order matters — list leads with everyday-decision categories the user
// asked for: occasions first, then specific foods, then broader cuisines.
const CATEGORIES: CategoryDef[] = [
  // Occasions
  {
    slug: "date-night", title: "Top 10 Date Night",
    gradient: ["#7E1538", "#280008"], iconGlyph: "D",
    match: (r) => (r as any).occasion_tags?.includes?.("date_night") ?? false,
  },
  {
    slug: "late-night", title: "Top 10 Late Night",
    gradient: ["#0F1A2E", "#000408"], iconGlyph: "L",
    match: (r) => (r as any).occasion_tags?.includes?.("late_night") ?? false,
  },
  {
    slug: "early-morning", title: "Top 10 Early Morning",
    gradient: ["#FFB347", "#7A4400"], iconGlyph: "M",
    match: (r) => (r as any).occasion_tags?.includes?.("breakfast")
      || any(r, ["breakfast", "diner", "bagel", "donut", "doughnut"]),
  },
  {
    slug: "brunch", title: "Top 10 Brunch",
    gradient: ["#F4A26A", "#7B2D00"], iconGlyph: "U",
    match: (r) => (r as any).occasion_tags?.includes?.("brunch")
      || any(r, ["brunch", "brunch_modern"]),
  },

  // Foods (specific dishes — fast food OK if it ranks)
  {
    slug: "burgers", title: "Top 10 Burgers",
    gradient: ["#FF3008", "#7A0B00"], iconGlyph: "B",
    match: (r) => any(r, ["burger", "burgers", "smashburger"]),
  },
  {
    slug: "wings", title: "Top 10 Wings",
    gradient: ["#FF8C00", "#5A1E00"], iconGlyph: "W",
    match: (r) => any(r, ["wing", "wings", "buffalo"]),
  },
  {
    slug: "fries", title: "Top 10 Fries",
    gradient: ["#FFC04D", "#6B4500"], iconGlyph: "F",
    match: (r) => any(r, ["fries", "frites", "fry"]),
  },
  {
    slug: "hummus", title: "Top 10 Hummus",
    gradient: ["#A89052", "#3D2F0E"], iconGlyph: "H",
    match: (r) => any(r, ["hummus", "mediterranean", "lebanese", "israeli", "middle_eastern", "middle eastern"]),
  },
  {
    slug: "steaks", title: "Top 10 Steaks",
    gradient: ["#2B0A0A", "#000000"], iconGlyph: "K",
    match: (r) => any(r, ["steak", "steakhouse", "chophouse"]),
  },
  {
    slug: "pizza", title: "Top 10 Pizza",
    gradient: ["#FF6B45", "#9C2200"], iconGlyph: "P",
    match: (r) => any(r, ["pizza", "pizzeria", "italian_pizzeria", "italian_neapolitan"]),
  },
  {
    slug: "tacos", title: "Top 10 Tacos",
    gradient: ["#FF8C42", "#7B2D00"], iconGlyph: "T",
    match: (r) => any(r, ["taco", "tacos", "taqueria", "mexican_taqueria"]),
  },
  {
    slug: "sushi", title: "Top 10 Sushi",
    gradient: ["#1F1F1F", "#000000"], iconGlyph: "S",
    match: (r) => any(r, ["sushi", "japanese_sushi"]),
  },
  {
    slug: "bbq", title: "Top 10 BBQ",
    gradient: ["#5C1F00", "#1B0700"], iconGlyph: "Q",
    match: (r) => any(r, ["bbq", "barbecue", "memphis_bbq", "texas_bbq", "kc_bbq"]),
  },

  // Cuisines (broader)
  {
    slug: "american", title: "Top 10 American",
    gradient: ["#3D5A80", "#0E1F36"], iconGlyph: "A",
    match: (r) => any(r, ["american", "diner", "tavern", "comfort"])
      || (r as any).cuisine_region === "american",
  },
  {
    slug: "italian", title: "Top 10 Italian",
    gradient: ["#7C2D12", "#1F0904"], iconGlyph: "I",
    match: (r) => any(r, ["italian", "trattoria", "osteria"])
      || (r as any).cuisine_region === "italian",
  },
  {
    slug: "caribbean", title: "Top 10 Caribbean",
    gradient: ["#0D8A6B", "#022B22"], iconGlyph: "R",
    match: (r) => any(r, ["caribbean", "jamaican", "haitian", "trinidadian", "cuban", "puerto rican", "dominican"])
      || (r as any).cuisine_region === "caribbean",
  },
  {
    slug: "cafes", title: "Top Cafés",
    gradient: ["#8C5B36", "#3A1D0A"], iconGlyph: "C",
    match: (r) => any(r, ["café", "cafe", "coffee"]) || (r as any).format_class === "café",
  },
];

function any(r: Restaurant, needles: string[]): boolean {
  const fields = [r.cuisine_type, (r as any).cuisine_subregion, (r as any).cuisine_region, (r as any).format_class].filter(Boolean) as string[];
  const hay = fields.join(" ").toLowerCase();
  return needles.some((n) => hay.includes(n.toLowerCase()));
}

const RADIUS_M = 5000;            // wider than Discover so lists feel "regional"
const TOP_N = 10;
const MIN_PER_LIST = 3;
const MAX_LISTS = 12;             // show up to 12 carousel cards

// ----------------------------------------------------------------------------
// Module-level cache. The Discover row populates this; the detail screen
// reads from it. Keyed by slug so entries are stable across renders.
// We cache by city too so switching browsing locations doesn't show a stale
// list from the previous city.
// ----------------------------------------------------------------------------
let cacheCityKey: string | null = null;
const cache = new Map<string, FeaturedList>();

export function getCachedFeaturedList(slug: string): FeaturedList | null {
  return cache.get(slug) ?? null;
}

export async function buildFeaturedLists(opts: {
  here: { lat: number; lng: number };
  city?: string | null;
  /** Optional: personalize ranking. Without these, falls back to pure
   *  popularity. Cold-start safe. */
  vector?: TasteVector | null;
  personal?: PersonalSignal | null;
}): Promise<FeaturedList[]> {
  const restaurants = await nearbyRestaurants(opts.here.lat, opts.here.lng, RADIUS_M);
  if (restaurants.length === 0) return [];

  // Pull the user's visit set so we can show "X of 10".
  const visitedIds = await loadUserVisitedIds();

  // Pre-compute popularity normalization across the whole nearby pool so
  // per-category ranks are comparable. log-scale dampens runaway top-rated
  // chains (50k reviews shouldn't completely outweigh a 200-review gem).
  const maxLogReviews = Math.max(
    ...restaurants.map((r) => Math.log10(1 + (r.user_rating_count ?? 0))),
    1,
  );

  const subtitle = opts.city ? `in ${opts.city}` : "Nearby";
  const lists: FeaturedList[] = [];

  for (const cat of CATEGORIES) {
    const matched = restaurants
      .filter(cat.match)
      // Lower the social-proof bar so fast-food / new spots can compete.
      .filter((r) => (r.user_rating_count ?? 0) >= 25);

    if (matched.length < MIN_PER_LIST) continue;

    // ---- Composite ranking: popularity + match fit + proximity ----
    // We blend these per-restaurant and then sort. Each component is 0..1.
    const scored = matched.map((r) => {
      const popularity = Math.log10(1 + (r.user_rating_count ?? 0)) / maxLogReviews;

      let fit = 0.5;            // neutral when no vector
      if (opts.vector) {
        const m = calculatePalateMatchScore(opts.vector, toInput(r), {
          here: opts.here,
          now: new Date(),
          personal: opts.personal ?? undefined,
          // Featured Lists are reference rails, not the recs feed — DON'T
          // apply anti-staleness here. Users want the canonical "Top X"
          // including their favorite even if they've been many times.
          applyStaleness: false,
        });
        fit = (m.score - 35) / 64; // unmap from 35..99 → 0..1
      }

      // Distance decay — within the 5km radius, closer ranks higher. Soft.
      let prox = 1;
      if (r.latitude != null && r.longitude != null) {
        const km = distanceKm(opts.here, { lat: r.latitude, lng: r.longitude });
        prox = Math.max(0, 1 - km / 6);
      }

      // Tunable blend. Popularity stays the largest single factor — Featured
      // Lists are still "what's hot" — but personal fit and proximity break
      // ties and steer the order toward "what's hot AND for you AND nearby".
      const composite = 0.45 * popularity + 0.35 * fit + 0.20 * prox;
      return { r, composite };
    });

    scored.sort((a, b) => b.composite - a.composite);
    const top = scored.slice(0, TOP_N).map((x) => x.r);

    const visited = top.filter((r) => visitedIds.has(r.google_place_id)).length;

    lists.push({
      slug: cat.slug,
      title: cat.title,
      subtitle,
      visitedCount: visited,
      totalCount: top.length,
      gradient: cat.gradient,
      iconGlyph: cat.iconGlyph,
      restaurants: top.map(toInput),
    });

    if (lists.length >= MAX_LISTS) break;
  }

  // Refresh cache for the detail screen.
  const cityKey = opts.city ?? `gps:${opts.here.lat.toFixed(2)},${opts.here.lng.toFixed(2)}`;
  if (cacheCityKey !== cityKey) {
    cache.clear();
    cacheCityKey = cityKey;
  }
  for (const l of lists) cache.set(l.slug, l);

  return lists;
}

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

function toInput(p: Restaurant): RestaurantInput {
  return {
    google_place_id: p.google_place_id,
    name: p.name,
    cuisine_type: p.cuisine_type ?? null,
    cuisine_region: (p as any).cuisine_region ?? null,
    cuisine_subregion: (p as any).cuisine_subregion ?? null,
    format_class: (p as any).format_class ?? null,
    occasion_tags: (p as any).occasion_tags ?? null,
    flavor_tags: (p as any).flavor_tags ?? null,
    cultural_context: (p as any).cultural_context ?? null,
    neighborhood: p.neighborhood ?? null,
    price_level: p.price_level ?? null,
    rating: p.rating ?? null,
    user_rating_count: (p as any).user_rating_count ?? null,
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
  };
}
