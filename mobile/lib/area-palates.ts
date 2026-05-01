// ============================================================================
// area-palates.ts — "Top Palates in your area" with FAKE preview data.
// ----------------------------------------------------------------------------
// Returns a small ranked list of common Palate identities for the user's
// region — labeled "preview data" until we have enough real users to compute
// it for real. Same swap-out story as population-stats.ts.
//
// Region detection is best-effort: we use the user's top-visited neighborhood
// and bucket it into a city. If we can't infer one, we return a neutral mix.
// ============================================================================

import { computeTasteVector } from "./taste-vector";

export type AreaPalate = {
  label: string;
  share: number; // 0..1, fake percentage of locals matching
};

export type AreaPalateSummary = {
  area: string;
  palates: AreaPalate[];
};

// Curated mix per city. When real data exists, swap this for an aggregator
// query. The mixes are deliberately plausible (not random) so the demo holds.
const CITY_MIXES: Record<string, AreaPalate[]> = {
  "New York": [
    { label: "Late-Night Halal Seeker", share: 0.18 },
    { label: "NY Slice Loyalist",       share: 0.14 },
    { label: "Brunch Socialite",        share: 0.12 },
    { label: "Bodega Breakfast Loyalist", share: 0.10 },
    { label: "Korean BBQ Group-Dinner Regular", share: 0.07 },
  ],
  "Brooklyn": [
    { label: "Italian Sunday Sauce Loyalist", share: 0.16 },
    { label: "Late-Night Pizza Crew",   share: 0.14 },
    { label: "Wine Bar Tastemaker",     share: 0.11 },
    { label: "Cuisine Cartographer",    share: 0.10 },
    { label: "Brunch Socialite",        share: 0.09 },
  ],
  "Philadelphia": [
    { label: "Bar Late-Night Regular",  share: 0.17 },
    { label: "Italian Devotee",         share: 0.13 },
    { label: "Cheesesteak Loyalist",    share: 0.11 },
    { label: "Brunch Socialite",        share: 0.10 },
    { label: "BYOB Connoisseur",        share: 0.08 },
  ],
  "Los Angeles": [
    { label: "Healthy Bowl Loyalist",   share: 0.18 },
    { label: "Taco Truck Cartographer", share: 0.15 },
    { label: "Brunch Socialite",        share: 0.12 },
    { label: "Korean BBQ Group-Dinner Regular", share: 0.09 },
    { label: "Wine Bar Tastemaker",     share: 0.08 },
  ],
  "Atlanta": [
    { label: "Atlanta Brunch Socialite", share: 0.19 },
    { label: "Southern Comfort Weekday Regular", share: 0.14 },
    { label: "Soul Food Regular",       share: 0.11 },
    { label: "Late-Night Bar-Snack Crew", share: 0.09 },
    { label: "Group-Dinner Socialite",  share: 0.08 },
  ],
  "Austin": [
    { label: "Texas Smoke Devotee",     share: 0.18 },
    { label: "Taco Truck Cartographer", share: 0.16 },
    { label: "Brunch Socialite",        share: 0.11 },
    { label: "Wine Bar Tastemaker",     share: 0.08 },
    { label: "Late-Night Bar-Snack Crew", share: 0.07 },
  ],
  "Chicago": [
    { label: "Deep Dish Devotee",       share: 0.15 },
    { label: "Italian Beef Loyalist",   share: 0.12 },
    { label: "Steakhouse Connoisseur",  share: 0.11 },
    { label: "Late-Night Bar-Snack Crew", share: 0.10 },
    { label: "Brunch Socialite",        share: 0.09 },
  ],
  "San Francisco": [
    { label: "Healthy Bowl Loyalist",   share: 0.16 },
    { label: "Cuisine Cartographer",    share: 0.13 },
    { label: "Wine Bar Tastemaker",     share: 0.11 },
    { label: "Café Morning Ritualist",  share: 0.10 },
    { label: "Modernist Curator",       share: 0.08 },
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
  const v = await computeTasteVector().catch(() => null);
  const topHood = v?.topNeighborhoods[0]?.name ?? null;

  let city: string | null = null;
  if (topHood) {
    for (const { match, city: c } of HOOD_TO_CITY) {
      if (match.test(topHood)) { city = c; break; }
    }
  }

  if (!city) return { area: topHood ?? "Your area", palates: DEFAULT_MIX };
  return { area: city, palates: CITY_MIXES[city] ?? DEFAULT_MIX };
}
