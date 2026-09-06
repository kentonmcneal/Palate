// ============================================================================
// area-palates.ts — "Top Palates in your area"
// ----------------------------------------------------------------------------
// REAL aggregated data, or nothing:
//   - If the user's city has >= REAL_DATA_THRESHOLD users with a palate set,
//     we return real percentages from the population_city_palate_counts view.
//   - Otherwise we return a curated city-specific mix (or a generic mix if
//     we can't infer a city).
//
// There is no preview mode. It used to fall back to a hand-written mix of
// palates per city, rendered as "TOP PALATES IN MEMPHIS · preview" with
// percentages beside each one. The founder cut exactly that card from the
// Wrapped tab on 2026-09-05, for the reason that a fabricated leaderboard with
// a hedge attached still reads as a leaderboard. It survived on Profile ->
// Insights until 2026-09-06 because the cut was made per screen instead of at
// the source. Under the threshold this returns null and the card does not
// render.
// ============================================================================

import { computeTasteVector } from "./taste-vector";
import { supabase } from "./supabase";
import { getMyProfile } from "./profile";

const REAL_DATA_THRESHOLD = 25;

export type AreaPalate = {
  label: string;
  share: number; // 0..1, measured share of real local accounts
};

export type AreaPalateSummary = {
  area: string;
  palates: AreaPalate[];
  /** Always "real". There is no other kind; see the note at the top. */
  source: "real";
};

// City mixes use the Curator/Forager/Steward/Anchor identity system, paired
// with a one-word cultural cue. Format: "{Identity} · {Modifier}".
//   Curator → Premium + Novelty
//   Forager → Casual + Novelty
//   Steward → Premium + Consistency
//   Anchor  → Casual + Consistency
// Modifiers reflect what locals are known for, not stereotypes.
// Map common neighborhood substrings to a city key. Heuristic only — when we
// have real user location data, swap for a proper geocoder.
const HOOD_TO_CITY: Array<{ match: RegExp; city: string }> = [
  { match: /manhattan|midtown|soho|tribeca|chelsea|harlem|west village|east village|lower east side/i, city: "New York" },
  { match: /brooklyn|williamsburg|bushwick|park slope|cobble hill|dumbo|prospect/i, city: "Brooklyn" },
  { match: /center city|fishtown|northern liberties|south philly|rittenhouse|university city/i, city: "Philadelphia" },
  { match: /los angeles|santa monica|venice|silver lake|west hollywood|culver city|pasadena/i, city: "Los Angeles" },
  { match: /atlanta|buckhead|midtown atl|inman park|virginia.?highland/i, city: "Atlanta" },
  { match: /memphis|cooper.?young|overton square|beale|germantown|collierville/i, city: "Memphis" },
  { match: /austin|south congress|east austin|domain/i, city: "Austin" },
  { match: /chicago|wicker park|lincoln park|river north|lakeview/i, city: "Chicago" },
  { match: /san francisco|mission|hayes valley|noe valley|north beach/i, city: "San Francisco" },
];

export async function getAreaPalates(): Promise<AreaPalateSummary | null> {
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
    if (!city) return null;
  }

  // 2. Real rows for this city, or nothing.
  return await tryRealAreaPalates(city);
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
