// ============================================================================
// featured-lists.ts — Beli-style "Top 10 X" curated lists.
// ----------------------------------------------------------------------------
// Each list is a category cut against the user's nearby restaurants. Cover
// is a gradient pair per cuisine (no photos in the catalog yet). Progress
// counts how many of the top 10 the user has visited.
// ============================================================================

import { supabase } from "./supabase";
import { nearbyRestaurants, type Restaurant } from "./places";
import type { RestaurantInput } from "./palate-match-score";

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

const CATEGORIES: CategoryDef[] = [
  {
    slug: "burgers", title: "Top 10 Burgers",
    gradient: ["#FF3008", "#7A0B00"], iconGlyph: "B",
    match: (r) => any(r, ["burger", "burgers"]),
  },
  {
    slug: "pizza", title: "Top 10 Pizza",
    gradient: ["#FF6B45", "#9C2200"], iconGlyph: "P",
    match: (r) => any(r, ["pizza", "pizzeria"]),
  },
  {
    slug: "sushi", title: "Top 10 Sushi",
    gradient: ["#1F1F1F", "#000000"], iconGlyph: "S",
    match: (r) => any(r, ["sushi", "japanese_sushi"]),
  },
  {
    slug: "ramen", title: "Top 10 Ramen",
    gradient: ["#3F1A12", "#0A0606"], iconGlyph: "R",
    match: (r) => any(r, ["ramen", "japanese_ramen"]),
  },
  {
    slug: "tacos", title: "Top 10 Tacos",
    gradient: ["#FF8C42", "#7B2D00"], iconGlyph: "T",
    match: (r) => any(r, ["taco", "tacos", "mexican_taqueria", "mexican"]),
  },
  {
    slug: "bbq", title: "Top 10 BBQ",
    gradient: ["#5C1F00", "#1B0700"], iconGlyph: "Q",
    match: (r) => any(r, ["bbq", "barbecue", "memphis_bbq", "texas_bbq", "kc_bbq"]),
  },
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
    slug: "cafes", title: "Top Cafés",
    gradient: ["#8C5B36", "#3A1D0A"], iconGlyph: "C",
    match: (r) => any(r, ["café", "cafe", "coffee"]) || (r as any).format_class === "café",
  },
  {
    slug: "steakhouses", title: "Top Steakhouses",
    gradient: ["#2B0A0A", "#000000"], iconGlyph: "K",
    match: (r) => any(r, ["steak", "steakhouse"]),
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
const MAX_LISTS = 6;

export async function buildFeaturedLists(opts: {
  here: { lat: number; lng: number };
  city?: string | null;
}): Promise<FeaturedList[]> {
  const restaurants = await nearbyRestaurants(opts.here.lat, opts.here.lng, RADIUS_M);
  if (restaurants.length === 0) return [];

  // Pull the user's visit set so we can show "X of 10".
  const visitedIds = await loadUserVisitedIds();

  const subtitle = opts.city ? `in ${opts.city}` : "Nearby";
  const lists: FeaturedList[] = [];

  for (const cat of CATEGORIES) {
    const matched = restaurants
      .filter(cat.match)
      .filter((r) => (r.user_rating_count ?? 0) >= 50)
      .sort((a, b) => (b.user_rating_count ?? 0) - (a.user_rating_count ?? 0))
      .slice(0, TOP_N);

    if (matched.length < MIN_PER_LIST) continue;

    const visited = matched.filter((r) => visitedIds.has(r.google_place_id)).length;

    lists.push({
      slug: cat.slug,
      title: cat.title,
      subtitle,
      visitedCount: visited,
      totalCount: matched.length,
      gradient: cat.gradient,
      iconGlyph: cat.iconGlyph,
      restaurants: matched.map(toInput),
    });

    if (lists.length >= MAX_LISTS) break;
  }

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
