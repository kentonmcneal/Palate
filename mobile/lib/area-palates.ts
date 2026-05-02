// ============================================================================
// area-palates.ts — "Top Palates in your area"
// ----------------------------------------------------------------------------
// Auto-swaps between FAKE preview data and REAL aggregated data:
//   - If the user's city has >= REAL_DATA_THRESHOLD users with a palate set,
//     we return real percentages from the population_city_palate_counts view.
//   - Otherwise we return a curated city-specific mix (or a generic mix if
//     we can't infer a city).
//
// The `source` field tells the UI whether to show the "preview data" label.
// ============================================================================

import { computeTasteVector } from "./taste-vector";
import { supabase } from "./supabase";
import { getMyProfile } from "./profile";

const REAL_DATA_THRESHOLD = 25;

export type AreaPalate = {
  label: string;
  share: number; // 0..1, fake percentage of locals matching
};

export type AreaPalateSummary = {
  area: string;
  palates: AreaPalate[];
  source: "real" | "preview";
};

// Mix per region. Broad cultural cues, not city stereotypes.
const CITY_MIXES: Record<string, AreaPalate[]> = {
  "New York": [
    { label: "Late-Night Halal Seeker",       share: 0.18 },
    { label: "Northeast Slice Loyalist",      share: 0.14 },
    { label: "Brunch Socialite",              share: 0.12 },
    { label: "Corner Store Breakfast Loyalist", share: 0.10 },
    { label: "Korean BBQ Group-Dinner Regular", share: 0.07 },
  ],
  "Brooklyn": [
    { label: "Italian Sunday Sauce Loyalist", share: 0.16 },
    { label: "Late-Night Pizza Crew",         share: 0.14 },
    { label: "Wine Bar Tastemaker",           share: 0.11 },
    { label: "Cuisine Cartographer",          share: 0.10 },
    { label: "Brunch Socialite",              share: 0.09 },
  ],
  "Philadelphia": [
    { label: "Bar Late-Night Regular",        share: 0.17 },
    { label: "Italian Devotee",               share: 0.13 },
    { label: "Northeast Comfort Loyalist",    share: 0.11 },
    { label: "Brunch Socialite",              share: 0.10 },
    { label: "Wine Bar Tastemaker",           share: 0.08 },
  ],
  "Los Angeles": [
    { label: "West Coast Healthy Loyalist",   share: 0.18 },
    { label: "West Coast Taco Cartographer",  share: 0.15 },
    { label: "Brunch Socialite",              share: 0.12 },
    { label: "Korean BBQ Group-Dinner Regular", share: 0.09 },
    { label: "Wine Bar Tastemaker",           share: 0.08 },
  ],
  "Atlanta": [
    { label: "Southern Brunch Socialite",     share: 0.19 },
    { label: "Southern Comfort Weekday Regular", share: 0.14 },
    { label: "Soul Food Regular",             share: 0.11 },
    { label: "Late-Night Bar-Snack Crew",     share: 0.09 },
    { label: "Group-Dinner Socialite",        share: 0.08 },
  ],
  "Austin": [
    { label: "Southern BBQ Devotee",          share: 0.18 },
    { label: "South Taco Cartographer",       share: 0.16 },
    { label: "Brunch Socialite",              share: 0.11 },
    { label: "Wine Bar Tastemaker",           share: 0.08 },
    { label: "Late-Night Bar-Snack Crew",     share: 0.07 },
  ],
  "Chicago": [
    { label: "Midwest Deep Dish Devotee",     share: 0.15 },
    { label: "Midwest Comfort Loyalist",      share: 0.12 },
    { label: "Steakhouse Connoisseur",        share: 0.11 },
    { label: "Late-Night Bar-Snack Crew",     share: 0.10 },
    { label: "Brunch Socialite",              share: 0.09 },
  ],
  "San Francisco": [
    { label: "West Coast Healthy Loyalist",   share: 0.16 },
    { label: "Cuisine Cartographer",          share: 0.13 },
    { label: "Wine Bar Tastemaker",           share: 0.11 },
    { label: "Café Morning Ritualist",        share: 0.10 },
    { label: "Modernist Curator",             share: 0.08 },
  ],
};

const DEFAULT_MIX: AreaPalate[] = [
  { label: "Brunch Socialite",                share: 0.14 },
  { label: "Comfort-Food Weeknight Loyalist", share: 0.12 },
  { label: "Café Morning Ritualist",          share: 0.10 },
  { label: "Cuisine Cartographer",            share: 0.09 },
  { label: "Wine Bar Tastemaker",             share: 0.07 },
];

// Map common neighborhood substrings to a city key. Heuristic only — when we
// have real user location data, swap for a proper geocoder.
const HOOD_TO_CITY: Array<{ match: RegExp; city: string }> = [
  { match: /manhattan|midtown|soho|tribeca|chelsea|harlem|west village|east village|lower east side/i, city: "New York" },
  { match: /brooklyn|williamsburg|bushwick|park slope|cobble hill|dumbo|prospect/i, city: "Brooklyn" },
  { match: /center city|fishtown|northern liberties|south philly|rittenhouse|university city/i, city: "Philadelphia" },
  { match: /los angeles|santa monica|venice|silver lake|west hollywood|culver city|pasadena/i, city: "Los Angeles" },
  { match: /atlanta|buckhead|midtown atl|inman park|virginia.?highland/i, city: "Atlanta" },
  { match: /austin|south congress|east austin|domain/i, city: "Austin" },
  { match: /chicago|wicker park|lincoln park|river north|lakeview/i, city: "Chicago" },
  { match: /san francisco|mission|hayes valley|noe valley|north beach/i, city: "San Francisco" },
];

export async function getAreaPalates(): Promise<AreaPalateSummary> {
  // 1. Resolve a city, preferring user's self-reported current_city.
  const profile = await getMyProfile().catch(() => null);
  let city: string | null = profile?.current_city?.trim() || null;

  // Fall back to inferring from top neighborhood if no demographic city set.
  if (!city) {
    const v = await computeTasteVector().catch(() => null);
    const topHood = v?.topNeighborhoods[0]?.name ?? null;
    if (topHood) {
      for (const { match, city: c } of HOOD_TO_CITY) {
        if (match.test(topHood)) { city = c; break; }
      }
    }
    if (!city) return { area: topHood ?? "Your area", palates: DEFAULT_MIX, source: "preview" };
  }

  // 2. Try to fetch real data for this city
  const real = await tryRealAreaPalates(city);
  if (real) return real;

  // 3. Fall back to curated preview mix
  return { area: city, palates: CITY_MIXES[city] ?? DEFAULT_MIX, source: "preview" };
}

async function tryRealAreaPalates(city: string): Promise<AreaPalateSummary | null> {
  const { data, error } = await supabase
    .from("population_city_palate_counts")
    .select("city_label, palate_key, user_count")
    .eq("city_key", city.toLowerCase());
  if (error || !data) return null;

  const total = data.reduce((s, r: any) => s + (r.user_count ?? 0), 0);
  if (total < REAL_DATA_THRESHOLD) return null;

  const sorted = (data as Array<{ city_label: string; palate_key: string; user_count: number }>)
    .sort((a, b) => b.user_count - a.user_count)
    .slice(0, 5)
    .map((r) => ({
      label: prettyPalateKey(r.palate_key),
      share: r.user_count / total,
    }));

  return { area: data[0].city_label as string, palates: sorted, source: "real" };
}

function prettyPalateKey(k: string): string {
  // Maps stored quiz_persona keys to display labels. Mirrors STARTER_PERSONAS.
  const map: Record<string, string> = {
    convenience_loyalist: "The Convenience Loyalist",
    flavor_loyalist: "The Flavor Loyalist",
    premium_comfort_loyalist: "The Premium Comfort Loyalist",
    practical_variety_seeker: "The Practical Variety Seeker",
    explorer: "The Explorer",
    cafe_dweller: "The Café Dweller",
    comfort_connoisseur: "The Comfort Food Connoisseur",
    fast_casual_regular: "The Fast Casual Regular",
    social_diner: "The Social Diner",
  };
  return map[k] ?? k.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
