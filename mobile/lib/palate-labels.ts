// ============================================================================
// palate-labels.ts — composes specific Palate identities from a TasteVector.
// ----------------------------------------------------------------------------
// Pipeline:
//   1. Score each dimension's strength (cuisine subregion vs region, format,
//      time-of-day, neighborhood, behavioral archetype).
//   2. Pick the dominant 1–3 modifiers.
//   3. Pick a behavioral archetype noun.
//   4. Compose: [time?] [geo?] [cuisine] [format/occasion?] + Archetype.
//   5. If composition fails the quality bar, fall back to the curated
//      taxonomy of 150+ pre-built labels.
//
// Distinctiveness comes from COMBINATIONS, not from a giant list of strings.
// The label vocabularies below are intentionally small but high-signal.
// ============================================================================

import {
  type TasteVector,
  type WeightMap,
  topKey,
  topShare,
  topN,
} from "./taste-vector";

export type PalateIdentity = {
  /** "Memphis Smoke Loyalist", "Late-Night Halal Seeker", etc. */
  label: string;
  /** Plain-English explanation of the dominant signals. */
  evidence: string[];
  /** Confidence 0..1 — how strong the signal mix is. */
  confidence: number;
  /** Internal: was this composed from signals or fell back to taxonomy. */
  source: "composed" | "taxonomy";
};

export type PalateIdentitySet = {
  primary: PalateIdentity;
  /** Two secondaries that hit on different dimensions than the primary. */
  secondary: [PalateIdentity, PalateIdentity];
  /** Lighter, recency-biased label — based on this week's vector only. */
  weeklyMood: PalateIdentity;
};

// ============================================================================
// Vocabulary tables — dimension → human-friendly modifier word.
// ============================================================================

// Cuisine subregion → display fragment ("Memphis Smoke", "Korean BBQ", "Halal Cart")
const SUBREGION_LABEL: Record<string, string> = {
  memphis_bbq: "Memphis Smoke",
  kc_bbq: "Kansas City BBQ",
  texas_bbq: "Texas Smoke",
  nashville_hot: "Nashville Hot",
  cajun: "Cajun",
  soul_food: "Soul Food",
  bbq_general: "BBQ",

  korean: "Korean",
  korean_bbq: "Korean BBQ",
  japanese: "Japanese",
  japanese_ramen: "Ramen",
  japanese_sushi: "Sushi",
  japanese_izakaya: "Izakaya",
  chinese: "Chinese",
  chinese_szechuan: "Szechuan",
  chinese_cantonese: "Cantonese",
  chinese_xian: "Xi'an",
  taiwanese: "Taiwanese",
  vietnamese: "Vietnamese",
  vietnamese_pho: "Pho",
  vietnamese_banh_mi: "Banh Mi",
  thai: "Thai",

  indian_north: "North Indian",
  indian_south: "South Indian",
  pakistani: "Pakistani",
  bangladeshi: "Bangladeshi",

  halal_cart: "Halal Cart",
  persian: "Persian",
  lebanese: "Lebanese",
  israeli: "Israeli",
  turkish: "Turkish",
  middle_eastern: "Middle Eastern",

  greek: "Greek",
  moroccan: "Moroccan",
  mediterranean_general: "Mediterranean",

  italian_neapolitan: "Neapolitan",
  italian_trattoria: "Trattoria",
  italian_pizzeria: "Pizzeria",
  italian_general: "Italian",

  mexican: "Mexican",
  mexican_taqueria: "Taco Truck",
  mexican_regional: "Regional Mexican",
  peruvian: "Peruvian",
  brazilian: "Brazilian",
  argentine: "Argentine",
  cuban: "Cuban",
  dominican: "Dominican",
  puerto_rican: "Puerto Rican",

  jamaican: "Jamaican",
  trinidadian: "Trinidadian",
  haitian: "Haitian",

  ethiopian: "Ethiopian",
  nigerian: "Nigerian",
  senegalese: "Senegalese",

  american_diner: "Diner",
  deli_jewish: "Deli",
  pizza_nyc: "NY Slice",
  pizza_chicago: "Deep Dish",
  breakfast_diner: "Diner Breakfast",
  burger: "Burger",
  bodega_food: "Bodega",

  wine_bar_food: "Wine Bar",
  steakhouse: "Steakhouse",
  seafood_house: "Seafood",
  brunch_modern: "Brunch",
  café: "Café",
};

// Cuisine region → display fragment (used when subregion isn't strong enough)
const REGION_LABEL: Record<string, string> = {
  southern_us: "Southern",
  east_asian: "East Asian",
  south_asian: "South Asian",
  middle_eastern: "Middle Eastern",
  mediterranean: "Mediterranean",
  italian: "Italian",
  latin_american: "Latin",
  caribbean: "Caribbean",
  african: "African",
  american: "American",
  european: "European",
  café_culture: "Café",
};

// Format class → display fragment
const FORMAT_LABEL: Record<string, string> = {
  quick_service: "Quick-Service",
  fast_casual: "Fast-Casual",
  casual_dining: "Casual",
  fine_dining: "Fine-Dining",
  café: "Café",
  bar: "Bar",
  wine_bar: "Wine Bar",
  food_truck: "Food Truck",
  bodega: "Bodega",
  ghost_kitchen: "Delivery",
  market_hall: "Market Hall",
  hotel_dining: "Hotel Dining",
};

// Occasion tag → display fragment
const OCCASION_LABEL: Record<string, string> = {
  date_night: "Date-Night",
  group_dinner: "Group-Dinner",
  casual_solo: "Solo",
  brunch: "Brunch",
  late_night: "Late-Night",
  breakfast: "Breakfast",
  working_lunch: "Lunch-Hour",
  weekend_anchor: "Weekend",
};

// Behavioral archetype nouns (the closing word of every label)
type Archetype =
  | "Loyalist"     // high repeat
  | "Regular"      // moderate repeat to specific spots
  | "Ritualist"    // same time/day pattern
  | "Seeker"       // moderate exploration
  | "Cartographer" // very high exploration + many neighborhoods
  | "Explorer"     // many cuisines
  | "Devotee"      // single cuisine focus
  | "Connoisseur"  // high price tier
  | "Tastemaker"   // high price spread + trending
  | "Socialite"    // group occasions, weekend skew
  | "Curator"      // few visits, high quality bar
  | "Pilgrim"      // crosses neighborhoods for one cuisine
  | "Patron";      // high spend, repeat

// ============================================================================
// Public entry point — compose 4 identities from a vector.
// ============================================================================

export function generateIdentitySet(allTime: TasteVector, weekly?: TasteVector): PalateIdentitySet {
  const composed = composeRanked(allTime);

  const primary = composed[0] ?? fallback(allTime);
  // Pick secondaries with different archetypes / different dimension hits.
  const secondary = pickDistinctSecondaries(composed.slice(1), primary);

  const weeklyMood = weekly
    ? composeRanked(weekly)[0] ?? fallback(weekly, { mood: true })
    : fallback(allTime, { mood: true });

  return { primary, secondary: [secondary[0], secondary[1]], weeklyMood };
}

// ============================================================================
// Compose — generate a ranked list of candidate identities. Highest ranked is
// the most distinctive (most specific signals + strong archetype fit).
// ============================================================================

function composeRanked(v: TasteVector): PalateIdentity[] {
  if (v.visitCount === 0 && v.wishlistCount === 0) return [];

  const out: PalateIdentity[] = [];

  const subTop = topN(v.cuisineSubregion, 3).filter((x) => SUBREGION_LABEL[x.key]);
  const regionTop = topN(v.cuisineRegion, 3).filter((x) => REGION_LABEL[x.key]);
  const formatTop = topN(v.formatClass, 3).filter((x) => FORMAT_LABEL[x.key]);
  const occasionTop = topN(v.occasion, 3).filter((x) => OCCASION_LABEL[x.key]);
  const timeMod = pickTimeModifier(v);
  const neighborhoodMod = pickNeighborhoodModifier(v);
  const archetypes = rankArchetypes(v);

  for (const archetype of archetypes) {
    // Variant A: subregion-led ("Memphis Smoke Loyalist")
    if (subTop.length > 0 && subTop[0].share >= 0.25) {
      const sub = SUBREGION_LABEL[subTop[0].key];
      const fmt = formatTop[0]?.share >= 0.4 ? FORMAT_LABEL[formatTop[0].key] : null;
      const time = timeMod;
      const parts = compact([time, neighborhoodMod, sub, fmt && fmt !== sub ? fmt : null, archetype.name]);
      const label = uniqueWords(parts).join(" ");
      out.push(makeIdentity(label, [
        `Cuisine concentrated in ${sub} (${pctText(subTop[0].share)}).`,
        archetype.evidence,
      ], computeConfidence(v, subTop[0].share, archetype.score)));
    }

    // Variant B: region-led when subregion isn't strong but region is
    if ((subTop.length === 0 || subTop[0].share < 0.25) && regionTop.length > 0 && regionTop[0].share >= 0.35) {
      const region = REGION_LABEL[regionTop[0].key];
      const occ = occasionTop[0]?.share >= 0.4 ? OCCASION_LABEL[occasionTop[0].key] : null;
      const time = timeMod;
      const parts = compact([time, neighborhoodMod, region, occ, archetype.name]);
      const label = uniqueWords(parts).join(" ");
      out.push(makeIdentity(label, [
        `Anchored in ${region} cuisine (${pctText(regionTop[0].share)}).`,
        archetype.evidence,
      ], computeConfidence(v, regionTop[0].share, archetype.score)));
    }

    // Variant C: format/occasion-led ("Fast-Casual Ritualist", "Bodega Breakfast Loyalist")
    if (formatTop.length > 0 && formatTop[0].share >= 0.5) {
      const fmt = FORMAT_LABEL[formatTop[0].key];
      const occ = occasionTop[0]?.share >= 0.35 ? OCCASION_LABEL[occasionTop[0].key] : null;
      const parts = compact([timeMod, fmt, occ, archetype.name]);
      const label = uniqueWords(parts).join(" ");
      out.push(makeIdentity(label, [
        `Mostly ${fmt.toLowerCase()} (${pctText(formatTop[0].share)}).`,
        archetype.evidence,
      ], computeConfidence(v, formatTop[0].share, archetype.score) * 0.9));
    }

    // Variant D: high-low / spread-led ("High-Low Tastemaker")
    if (v.priceSpread >= 0.66 && archetype.name === "Tastemaker") {
      const parts = compact(["High-Low", archetype.name]);
      out.push(makeIdentity(parts.join(" "), [
        "Visits span both casual and upscale price tiers.",
        archetype.evidence,
      ], 0.7));
    }

    // Variant E: neighborhood-led ("Bodega Breakfast Loyalist", "Atlanta Brunch Socialite")
    if (neighborhoodMod && v.neighborhoodLoyalty >= 0.45 && archetype.name !== "Cartographer") {
      const occ = occasionTop[0]?.share >= 0.35 ? OCCASION_LABEL[occasionTop[0].key] : null;
      const cuisine = subTop[0] && SUBREGION_LABEL[subTop[0].key]
        ? SUBREGION_LABEL[subTop[0].key]
        : (regionTop[0] && REGION_LABEL[regionTop[0].key]) ?? null;
      const parts = compact([neighborhoodMod, cuisine, occ, archetype.name]);
      const label = uniqueWords(parts).join(" ");
      out.push(makeIdentity(label, [
        `Anchored to ${neighborhoodMod} (${pctText(v.neighborhoodLoyalty)} of visits).`,
        archetype.evidence,
      ], 0.65));
    }
  }

  // Dedupe + filter to quality bar
  const seen = new Set<string>();
  return out
    .filter((id) => {
      if (seen.has(id.label)) return false;
      seen.add(id.label);
      return passesQualityBar(id.label);
    })
    .sort((a, b) => b.confidence - a.confidence);
}

function pickDistinctSecondaries(
  candidates: PalateIdentity[],
  primary: PalateIdentity,
): [PalateIdentity, PalateIdentity] {
  const primaryArchetype = lastWord(primary.label);
  const distinct = candidates.filter((c) => lastWord(c.label) !== primaryArchetype);
  const a = distinct[0] ?? candidates[0] ?? fallback(emptyForFallback());
  const remaining = distinct.filter((c) => c.label !== a.label);
  const b = remaining[0] ?? candidates.find((c) => c.label !== a.label) ?? fallback(emptyForFallback(), { mood: true });
  return [a, b];
}

// ============================================================================
// Time / neighborhood modifiers
// ============================================================================
function pickTimeModifier(v: TasteVector): string | null {
  const total = v.hourly.reduce((s, n) => s + n, 0);
  if (total < 3) return null;
  const lateNight = (v.hourly[21] + v.hourly[22] + v.hourly[23] + v.hourly[0]) / total;
  const earlyMorning = (v.hourly[5] + v.hourly[6] + v.hourly[7] + v.hourly[8]) / total;
  const lunch = (v.hourly[12] + v.hourly[13]) / total;
  if (lateNight >= 0.3) return "Late-Night";
  if (earlyMorning >= 0.3) return "Early-Riser";
  if (v.weekendShare >= 0.55) return "Weekend";
  if (v.weekendShare <= 0.2) return "Weekday";
  if (lunch >= 0.4) return "Lunch-Hour";
  return null;
}

function pickNeighborhoodModifier(v: TasteVector): string | null {
  if (v.topNeighborhoods.length === 0) return null;
  if (v.neighborhoodLoyalty < 0.4) return null;
  // Use the actual neighborhood name verbatim — short ones only, otherwise too unwieldy
  const name = v.topNeighborhoods[0].name;
  if (name.length <= 18) return name;
  return null;
}

// ============================================================================
// Archetype ranking — every archetype gets a score; pick the top-fit ones.
// ============================================================================

function rankArchetypes(v: TasteVector): { name: Archetype; score: number; evidence: string }[] {
  const out: { name: Archetype; score: number; evidence: string }[] = [];

  // Loyalist: high repeat rate
  if (v.repeatRate >= 0.5) out.push({
    name: "Loyalist",
    score: v.repeatRate,
    evidence: `${pctText(v.repeatRate)} of visits go to repeat spots.`,
  });

  // Regular: moderate repeat (3+ visits to a single spot)
  if (v.repeatRate >= 0.3 && v.repeatRate < 0.6) out.push({
    name: "Regular",
    score: 0.6,
    evidence: `You return to the same spots ${pctText(v.repeatRate)} of the time.`,
  });

  // Ritualist: tight time-of-day window (60%+ in any 4-hour band)
  const tight = findTightHourWindow(v.hourly, 4);
  if (tight && tight.share >= 0.6) out.push({
    name: "Ritualist",
    score: tight.share,
    evidence: `${pctText(tight.share)} of visits fall in a single 4-hour window.`,
  });

  // Seeker / Cartographer: high exploration
  if (v.explorationRate >= 0.7 && v.uniqueRestaurants >= 8 && v.topNeighborhoods.length >= 4) {
    out.push({
      name: "Cartographer",
      score: 0.85,
      evidence: `You're spreading visits across ${v.topNeighborhoods.length}+ neighborhoods, rarely repeating.`,
    });
  } else if (v.explorationRate >= 0.6) {
    out.push({
      name: "Seeker",
      score: v.explorationRate,
      evidence: `${pctText(v.explorationRate)} of your visits are to new spots.`,
    });
  }

  // Explorer: many cuisines (≥5 distinct subregions or regions)
  const cuisineDiversity = Object.keys(v.cuisineRegion).length;
  if (cuisineDiversity >= 5) out.push({
    name: "Explorer",
    score: Math.min(1, cuisineDiversity / 8),
    evidence: `You eat across ${cuisineDiversity}+ different cuisines.`,
  });

  // Devotee: single cuisine focus (top region ≥ 60%)
  const topRegionShare = topShare(v.cuisineRegion);
  if (topRegionShare >= 0.6) out.push({
    name: "Devotee",
    score: topRegionShare,
    evidence: `Your top cuisine is ${pctText(topRegionShare)} of your visits.`,
  });

  // Connoisseur: high average price tier
  if (v.averagePriceLevel >= 3) out.push({
    name: "Connoisseur",
    score: Math.min(1, v.averagePriceLevel / 4),
    evidence: `Your average spot sits at price tier ${v.averagePriceLevel.toFixed(1)} of 4.`,
  });

  // Tastemaker: high price spread (high-low) + diverse
  if (v.priceSpread >= 0.66 && cuisineDiversity >= 3) out.push({
    name: "Tastemaker",
    score: 0.75,
    evidence: "You move between casual and upscale spots fluently.",
  });

  // Socialite: weekend + group/date occasions
  const groupShare = (v.occasion["group_dinner"] ?? 0) + (v.occasion["date_night"] ?? 0);
  const occasionTotal = Object.values(v.occasion).reduce((s, n) => s + n, 0);
  const groupOccasionShare = occasionTotal > 0 ? groupShare / occasionTotal : 0;
  if (v.weekendShare >= 0.5 && groupOccasionShare >= 0.4) out.push({
    name: "Socialite",
    score: 0.7,
    evidence: "You eat out for the table, not the meal — mostly weekends, mostly with people.",
  });

  // Curator: few visits, high quality bar (≥ premium)
  if (v.visitCount > 0 && v.visitCount < 8 && v.averagePriceLevel >= 3) out.push({
    name: "Curator",
    score: 0.6,
    evidence: "Few visits, but each one's deliberate.",
  });

  // Pilgrim: high neighborhood spread for one cuisine
  if (v.geographicSpreadKm >= 8 && topRegionShare >= 0.4) out.push({
    name: "Pilgrim",
    score: 0.6,
    evidence: `You'll travel ${v.geographicSpreadKm.toFixed(1)}km for the right cuisine.`,
  });

  // Patron: high price + high repeat
  if (v.averagePriceLevel >= 2.5 && v.repeatRate >= 0.4) out.push({
    name: "Patron",
    score: 0.55,
    evidence: "Same upmarket spots, on rotation.",
  });

  if (out.length === 0) {
    out.push({ name: "Regular", score: 0.3, evidence: "You eat out often enough to read a pattern." });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 6);
}

// ============================================================================
// Quality bar + helpers
// ============================================================================
function passesQualityBar(label: string): boolean {
  const words = label.split(/\s+/);
  // At least one modifier + an archetype noun
  return words.length >= 2 && label.length >= 8;
}

function computeConfidence(v: TasteVector, dominantShare: number, archetypeScore: number): number {
  const sample = Math.min(1, (v.visitCount + v.wishlistCount * 0.5) / 12);
  return Math.min(1, 0.4 + 0.3 * dominantShare + 0.2 * archetypeScore + 0.1 * sample);
}

function compact<T>(arr: (T | null | undefined | false)[]): T[] {
  return arr.filter((x): x is T => !!x);
}

function uniqueWords(parts: string[]): string[] {
  const seenWord = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (seenWord.has(lower)) continue;
    seenWord.add(lower);
    out.push(p);
  }
  return out;
}

function lastWord(label: string): string {
  const parts = label.trim().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

function pctText(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function makeIdentity(label: string, evidence: string[], confidence: number): PalateIdentity {
  return { label, evidence, confidence, source: "composed" };
}

function emptyForFallback(): TasteVector {
  return {
    visitCount: 0, wishlistCount: 0, cuisineRegion: {}, cuisineSubregion: {},
    cuisineRegionAspirational: {}, cuisineSubregionAspirational: {},
    formatClass: {}, priceTier: {}, chainType: {}, occasion: {}, flavor: {},
    culturalContext: {}, topNeighborhoods: [], neighborhoodLoyalty: 0,
    geographicSpreadKm: 0, hourly: new Array(24).fill(0),
    dowCounts: new Array(7).fill(0), weekendShare: 0, repeatRate: 0,
    explorationRate: 1, uniqueRestaurants: 0, averagePriceLevel: 0,
    priceSpread: 0, aspirationalGap: 0, aspirationTags: {},
  };
}

function findTightHourWindow(hours: number[], windowSize: number): { start: number; share: number } | null {
  const total = hours.reduce((s, n) => s + n, 0);
  if (total === 0) return null;
  let best: { start: number; share: number } | null = null;
  for (let start = 0; start < 24; start++) {
    let sum = 0;
    for (let i = 0; i < windowSize; i++) sum += hours[(start + i) % 24];
    const share = sum / total;
    if (!best || share > best.share) best = { start, share };
  }
  return best;
}

// ============================================================================
// FALLBACK TAXONOMY — 150+ pre-composed labels mapped to dimension fingerprints.
// Used when composition can't reach the quality bar (sparse data, weird mix,
// or weekly-mood with very few visits).
// ----------------------------------------------------------------------------
// Format: a label + a small predicate on the vector. First match wins. Order
// from MORE-specific to LESS-specific so the engine always picks the tightest
// fit available.
// ============================================================================

type FallbackRule = {
  label: string;
  match: (v: TasteVector) => boolean;
};

function pickN<T>(arr: T[], n: number, fn: (x: T) => boolean): T[] {
  return arr.filter(fn).slice(0, n);
}

// Helpers for fallback predicates
const subShare = (v: TasteVector, key: string) => {
  const total = Object.values(v.cuisineSubregion).reduce((s, n) => s + n, 0);
  return total > 0 ? (v.cuisineSubregion[key] ?? 0) / total : 0;
};
const regionShare = (v: TasteVector, key: string) => {
  const total = Object.values(v.cuisineRegion).reduce((s, n) => s + n, 0);
  return total > 0 ? (v.cuisineRegion[key] ?? 0) / total : 0;
};
const formatShare = (v: TasteVector, key: string) => {
  const total = Object.values(v.formatClass).reduce((s, n) => s + n, 0);
  return total > 0 ? (v.formatClass[key] ?? 0) / total : 0;
};
const occShare = (v: TasteVector, key: string) => {
  const total = Object.values(v.occasion).reduce((s, n) => s + n, 0);
  return total > 0 ? (v.occasion[key] ?? 0) / total : 0;
};
const lateNightShare = (v: TasteVector) => {
  const total = v.hourly.reduce((s, n) => s + n, 0);
  return total > 0 ? (v.hourly[21] + v.hourly[22] + v.hourly[23] + v.hourly[0]) / total : 0;
};
const morningShare = (v: TasteVector) => {
  const total = v.hourly.reduce((s, n) => s + n, 0);
  return total > 0 ? (v.hourly[6] + v.hourly[7] + v.hourly[8] + v.hourly[9]) / total : 0;
};

const FALLBACK_RULES: FallbackRule[] = [
  // ---- Highly specific cuisine + behavior combos -----------------------------
  { label: "Memphis Smoke Loyalist",       match: (v) => subShare(v, "memphis_bbq") >= 0.3 && v.repeatRate >= 0.4 },
  { label: "Texas Smoke Devotee",          match: (v) => subShare(v, "texas_bbq") >= 0.3 },
  { label: "Kansas City BBQ Regular",      match: (v) => subShare(v, "kc_bbq") >= 0.3 },
  { label: "Nashville Hot Seeker",         match: (v) => subShare(v, "nashville_hot") >= 0.25 },
  { label: "Cajun Comfort Loyalist",       match: (v) => subShare(v, "cajun") >= 0.3 },
  { label: "Soul Food Regular",            match: (v) => subShare(v, "soul_food") >= 0.3 },
  { label: "Southern Comfort Weekday Regular", match: (v) => regionShare(v, "southern_us") >= 0.4 && v.weekendShare <= 0.3 },
  { label: "Southern Sunday Brunch Loyalist", match: (v) => regionShare(v, "southern_us") >= 0.3 && occShare(v, "brunch") >= 0.3 },

  { label: "Korean BBQ Group-Dinner Regular", match: (v) => subShare(v, "korean_bbq") >= 0.25 },
  { label: "Korean Late-Night Seeker",        match: (v) => subShare(v, "korean") >= 0.25 && lateNightShare(v) >= 0.3 },
  { label: "Ramen Night Owl",                 match: (v) => subShare(v, "japanese_ramen") >= 0.25 && lateNightShare(v) >= 0.25 },
  { label: "Sushi Counter Connoisseur",       match: (v) => subShare(v, "japanese_sushi") >= 0.3 && v.averagePriceLevel >= 3 },
  { label: "Sushi Weeknight Regular",         match: (v) => subShare(v, "japanese_sushi") >= 0.25 },
  { label: "Izakaya After-Work Crew",         match: (v) => subShare(v, "japanese_izakaya") >= 0.2 },
  { label: "Szechuan Heat Devotee",           match: (v) => subShare(v, "chinese_szechuan") >= 0.25 },
  { label: "Cantonese Brunch Loyalist",       match: (v) => subShare(v, "chinese_cantonese") >= 0.25 },
  { label: "Xi'an Hand-Pulled Pilgrim",       match: (v) => subShare(v, "chinese_xian") >= 0.2 },
  { label: "Pho Comfort Regular",             match: (v) => subShare(v, "vietnamese_pho") >= 0.25 },
  { label: "Banh Mi Lunch-Hour Loyalist",     match: (v) => subShare(v, "vietnamese_banh_mi") >= 0.2 },
  { label: "Thai Spice Devotee",              match: (v) => subShare(v, "thai") >= 0.3 },
  { label: "Taiwanese Tea Regular",           match: (v) => subShare(v, "taiwanese") >= 0.25 },

  { label: "South Indian Heritage Loyalist",  match: (v) => subShare(v, "indian_south") >= 0.25 },
  { label: "North Indian Comfort Regular",    match: (v) => subShare(v, "indian_north") >= 0.3 },
  { label: "Pakistani Late-Night Seeker",     match: (v) => subShare(v, "pakistani") >= 0.25 && lateNightShare(v) >= 0.2 },
  { label: "Halal Cart Late-Night Regular",   match: (v) => subShare(v, "halal_cart") >= 0.25 },
  { label: "Persian Hospitality Devotee",     match: (v) => subShare(v, "persian") >= 0.25 },
  { label: "Lebanese Mezze Regular",          match: (v) => subShare(v, "lebanese") >= 0.25 },
  { label: "Israeli Brunch Crew",             match: (v) => subShare(v, "israeli") >= 0.25 },
  { label: "Turkish Charcoal Loyalist",       match: (v) => subShare(v, "turkish") >= 0.25 },
  { label: "Greek Comfort Regular",           match: (v) => subShare(v, "greek") >= 0.3 },
  { label: "Moroccan Slow-Cook Devotee",      match: (v) => subShare(v, "moroccan") >= 0.25 },
  { label: "Mediterranean Lunch-Hour Ritualist", match: (v) => regionShare(v, "mediterranean") >= 0.4 && occShare(v, "working_lunch") >= 0.3 },

  { label: "Neapolitan Slice Devotee",        match: (v) => subShare(v, "italian_neapolitan") >= 0.25 },
  { label: "Trattoria Date-Night Regular",    match: (v) => subShare(v, "italian_trattoria") >= 0.2 && occShare(v, "date_night") >= 0.3 },
  { label: "Pizzeria Loyalist",               match: (v) => subShare(v, "italian_pizzeria") >= 0.3 },
  { label: "Italian Sunday Sauce Loyalist",   match: (v) => regionShare(v, "italian") >= 0.4 && v.weekendShare >= 0.5 },

  { label: "Taco Truck Cartographer",         match: (v) => subShare(v, "mexican_taqueria") >= 0.25 && v.explorationRate >= 0.6 },
  { label: "Taqueria Lunch-Hour Loyalist",    match: (v) => subShare(v, "mexican_taqueria") >= 0.3 },
  { label: "Regional Mexican Devotee",        match: (v) => subShare(v, "mexican_regional") >= 0.25 },
  { label: "Peruvian Ceviche Regular",        match: (v) => subShare(v, "peruvian") >= 0.25 },
  { label: "Brazilian Churrasco Patron",      match: (v) => subShare(v, "brazilian") >= 0.25 },
  { label: "Argentine Steakhouse Connoisseur", match: (v) => subShare(v, "argentine") >= 0.25 },
  { label: "Cuban Sandwich Regular",          match: (v) => subShare(v, "cuban") >= 0.25 },
  { label: "Dominican Comfort Loyalist",      match: (v) => subShare(v, "dominican") >= 0.25 },
  { label: "Puerto Rican Heritage Regular",   match: (v) => subShare(v, "puerto_rican") >= 0.25 },

  { label: "Caribbean Comfort Regular",       match: (v) => regionShare(v, "caribbean") >= 0.3 },
  { label: "Jamaican Jerk Loyalist",          match: (v) => subShare(v, "jamaican") >= 0.25 },
  { label: "Trinidadian Roti Devotee",        match: (v) => subShare(v, "trinidadian") >= 0.2 },
  { label: "Haitian Heritage Regular",        match: (v) => subShare(v, "haitian") >= 0.2 },

  { label: "Ethiopian Communal-Plate Crew",   match: (v) => subShare(v, "ethiopian") >= 0.2 },
  { label: "Nigerian Heritage Devotee",       match: (v) => subShare(v, "nigerian") >= 0.2 },
  { label: "Senegalese Slow-Sunday Regular",  match: (v) => subShare(v, "senegalese") >= 0.2 },
  { label: "African Diaspora Explorer",       match: (v) => regionShare(v, "african") >= 0.25 && v.explorationRate >= 0.5 },

  { label: "Diner Breakfast Ritualist",       match: (v) => subShare(v, "breakfast_diner") >= 0.25 || subShare(v, "american_diner") >= 0.3 },
  { label: "Deli Pastrami Loyalist",          match: (v) => subShare(v, "deli_jewish") >= 0.2 },
  { label: "NY Slice Loyalist",               match: (v) => subShare(v, "pizza_nyc") >= 0.3 },
  { label: "Deep Dish Devotee",               match: (v) => subShare(v, "pizza_chicago") >= 0.2 },
  { label: "Burger Joint Regular",            match: (v) => subShare(v, "burger") >= 0.3 },
  { label: "Steakhouse Connoisseur",          match: (v) => subShare(v, "steakhouse") >= 0.2 && v.averagePriceLevel >= 3 },
  { label: "Seafood Counter Regular",         match: (v) => subShare(v, "seafood_house") >= 0.2 },
  { label: "Bodega Breakfast Loyalist",       match: (v) => (subShare(v, "bodega_food") >= 0.2 || formatShare(v, "bodega") >= 0.2) && morningShare(v) >= 0.3 },

  // ---- Format / time-led ----------------------------------------------------
  { label: "Fast-Casual Ritualist",           match: (v) => formatShare(v, "fast_casual") >= 0.55 && v.repeatRate >= 0.4 },
  { label: "Quick-Service Loyalist",          match: (v) => formatShare(v, "quick_service") >= 0.5 && v.repeatRate >= 0.4 },
  { label: "Counter-Service Regular",         match: (v) => formatShare(v, "quick_service") >= 0.4 },
  { label: "Café Morning Ritualist",          match: (v) => formatShare(v, "café") >= 0.4 && morningShare(v) >= 0.4 },
  { label: "Café Workday Regular",            match: (v) => formatShare(v, "café") >= 0.35 },
  { label: "Wine Bar Tastemaker",             match: (v) => formatShare(v, "wine_bar") >= 0.3 },
  { label: "Bar Late-Night Regular",          match: (v) => formatShare(v, "bar") >= 0.3 && lateNightShare(v) >= 0.3 },
  { label: "Fine-Dining Curator",             match: (v) => formatShare(v, "fine_dining") >= 0.3 },
  { label: "Casual-Dining Patron",            match: (v) => formatShare(v, "casual_dining") >= 0.5 && v.averagePriceLevel >= 2.5 },
  { label: "Food Truck Cartographer",         match: (v) => formatShare(v, "food_truck") >= 0.2 && v.explorationRate >= 0.5 },
  { label: "Market Hall Explorer",            match: (v) => formatShare(v, "market_hall") >= 0.2 },

  // ---- Time + occasion ------------------------------------------------------
  { label: "Late-Night Halal Seeker",         match: (v) => lateNightShare(v) >= 0.3 && (subShare(v, "halal_cart") >= 0.15 || regionShare(v, "middle_eastern") >= 0.2) },
  { label: "Late-Night Ramen Regular",        match: (v) => lateNightShare(v) >= 0.3 && subShare(v, "japanese_ramen") >= 0.2 },
  { label: "Late-Night Bar-Snack Crew",       match: (v) => lateNightShare(v) >= 0.4 && formatShare(v, "bar") >= 0.2 },
  { label: "Late-Night Solo",                 match: (v) => lateNightShare(v) >= 0.4 && occShare(v, "casual_solo") >= 0.4 },
  { label: "Brunch Socialite",                match: (v) => occShare(v, "brunch") >= 0.4 && v.weekendShare >= 0.5 },
  { label: "Atlanta Brunch Socialite",        match: (v) => occShare(v, "brunch") >= 0.3 && v.topNeighborhoods[0]?.name?.toLowerCase().includes("atlanta") === true },
  { label: "Weekend Brunch Loyalist",         match: (v) => occShare(v, "brunch") >= 0.3 && v.weekendShare >= 0.5 },
  { label: "Weekday Lunch-Hour Loyalist",     match: (v) => occShare(v, "working_lunch") >= 0.4 && v.weekendShare <= 0.25 },
  { label: "Working-Lunch Regular",           match: (v) => occShare(v, "working_lunch") >= 0.35 },
  { label: "Date-Night Connoisseur",          match: (v) => occShare(v, "date_night") >= 0.35 && v.averagePriceLevel >= 2.5 },
  { label: "Group-Dinner Ritualist",          match: (v) => occShare(v, "group_dinner") >= 0.4 },

  // ---- Behavioral-only ------------------------------------------------------
  { label: "Independent-Spot Cartographer",   match: (v) => v.explorationRate >= 0.7 && (v.chainType["independent"] ?? 0) >= 4 },
  { label: "Chain Comfort Loyalist",          match: (v) => (v.chainType["national_chain"] ?? 0) / Math.max(1, v.visitCount) >= 0.5 && v.repeatRate >= 0.4 },
  { label: "High-Low Tastemaker",             match: (v) => v.priceSpread >= 0.66 },
  { label: "Cuisine Cartographer",            match: (v) => Object.keys(v.cuisineRegion).length >= 6 },
  { label: "Cuisine Devotee",                 match: (v) => topShare(v.cuisineRegion) >= 0.65 },
  { label: "Neighborhood Loyalist",           match: (v) => v.neighborhoodLoyalty >= 0.55 },
  { label: "Borough-Crossing Pilgrim",        match: (v) => v.geographicSpreadKm >= 10 },
  { label: "Hidden-Gem Hunter",               match: (v) => (v.culturalContext["hidden"] ?? 0) >= 3 },
  { label: "Trending-Spot Tastemaker",        match: (v) => (v.culturalContext["trending"] ?? 0) >= 3 },
  { label: "Heritage-Comfort Regular",        match: (v) => (v.culturalContext["heritage"] ?? 0) / Math.max(1, v.visitCount) >= 0.5 },
  { label: "Modernist Curator",               match: (v) => (v.culturalContext["modernist"] ?? 0) / Math.max(1, v.visitCount) >= 0.4 },

  // ---- Aspirational-only (when wishlist >> visits) --------------------------
  { label: "Aspirational Tastemaker",         match: (v) => v.wishlistCount >= 5 && v.visitCount === 0 },
  { label: "Date-Night Curator-in-Waiting",   match: (v) => (v.aspirationTags["date_night"] ?? 0) >= 3 },
  { label: "Adventurous Saver",               match: (v) => (v.aspirationTags["adventurous"] ?? 0) >= 3 },
  { label: "Healthy Aspirational",            match: (v) => (v.aspirationTags["healthy"] ?? 0) >= 3 },
  { label: "Cultural Aspirational",           match: (v) => (v.aspirationTags["cultural"] ?? 0) >= 3 },
  { label: "Chef-Driven Aspirational",        match: (v) => (v.aspirationTags["chef_driven"] ?? 0) >= 3 },
  { label: "Trendy-Spot Aspirational",        match: (v) => (v.aspirationTags["trendy"] ?? 0) >= 3 },
  { label: "Neighborhood Explorer-in-Waiting", match: (v) => (v.aspirationTags["neighborhood_explore"] ?? 0) >= 3 },

  // ---- Region-led generals --------------------------------------------------
  { label: "East Asian Explorer",             match: (v) => regionShare(v, "east_asian") >= 0.4 && v.explorationRate >= 0.4 },
  { label: "East Asian Devotee",              match: (v) => regionShare(v, "east_asian") >= 0.55 },
  { label: "South Asian Heritage Devotee",    match: (v) => regionShare(v, "south_asian") >= 0.4 },
  { label: "Latin American Explorer",         match: (v) => regionShare(v, "latin_american") >= 0.4 && v.explorationRate >= 0.4 },
  { label: "Mediterranean Devotee",           match: (v) => regionShare(v, "mediterranean") >= 0.45 },
  { label: "Italian Devotee",                 match: (v) => regionShare(v, "italian") >= 0.5 },
  { label: "Middle Eastern Devotee",          match: (v) => regionShare(v, "middle_eastern") >= 0.4 },
  { label: "American Comfort Loyalist",       match: (v) => regionShare(v, "american") >= 0.5 && v.repeatRate >= 0.4 },
  { label: "European Wine-Bar Patron",        match: (v) => regionShare(v, "european") >= 0.3 && formatShare(v, "wine_bar") >= 0.2 },

  // ---- Light / weekly mood-style fallbacks ----------------------------------
  { label: "Weekend Wanderer",                match: (v) => v.weekendShare >= 0.55 && v.explorationRate >= 0.5 },
  { label: "Weeknight Regular",               match: (v) => v.weekendShare <= 0.3 && v.repeatRate >= 0.4 },
  { label: "Working-Lunch Pragmatist",        match: (v) => occShare(v, "working_lunch") >= 0.3 },
  { label: "Quick-Bite Pragmatist",           match: (v) => formatShare(v, "quick_service") >= 0.4 },
  { label: "Slow-Saturday Café Crew",         match: (v) => formatShare(v, "café") >= 0.3 && v.weekendShare >= 0.4 },
  { label: "Neighborhood Newcomer",           match: (v) => v.visitCount > 0 && v.visitCount <= 3 },
  { label: "First-Week Tasting Tour",         match: (v) => v.visitCount > 0 && v.visitCount <= 5 && Object.keys(v.cuisineRegion).length >= 3 },

  // ---- Extended specifics (fills out the 150+ taxonomy) ---------------------
  { label: "Pizza Slice Ritualist",           match: (v) => subShare(v, "italian_pizzeria") >= 0.4 && v.repeatRate >= 0.4 },
  { label: "Coffee Shop Companion",           match: (v) => formatShare(v, "café") >= 0.5 && v.repeatRate >= 0.5 },
  { label: "Late-Night Pizza Crew",           match: (v) => subShare(v, "italian_pizzeria") >= 0.25 && lateNightShare(v) >= 0.3 },
  { label: "Sushi Lunch-Hour Regular",        match: (v) => subShare(v, "japanese_sushi") >= 0.2 && occShare(v, "working_lunch") >= 0.3 },
  { label: "Dim Sum Sunday Crew",             match: (v) => subShare(v, "chinese_cantonese") >= 0.2 && v.weekendShare >= 0.5 },
  { label: "Korean Late-Night Crew",          match: (v) => regionShare(v, "east_asian") >= 0.3 && subShare(v, "korean") >= 0.2 && lateNightShare(v) >= 0.25 },
  { label: "Healthy Bowl Loyalist",           match: (v) => (v.flavor["fresh"] ?? 0) + (v.flavor["light"] ?? 0) >= 4 && v.repeatRate >= 0.4 },
  { label: "Spice-Seeker Devotee",            match: (v) => (v.flavor["spicy"] ?? 0) >= 5 },
  { label: "Smoky-Flavor Devotee",            match: (v) => (v.flavor["smoky"] ?? 0) >= 4 },
  { label: "Umami-Forward Curator",           match: (v) => (v.flavor["umami"] ?? 0) >= 4 },
  { label: "Sweet-Tooth Brunch Regular",      match: (v) => (v.flavor["sweet"] ?? 0) >= 3 && occShare(v, "brunch") >= 0.25 },
  { label: "Comfort-Food Weeknight Loyalist", match: (v) => (v.flavor["rich"] ?? 0) >= 4 && v.weekendShare <= 0.35 },
  { label: "Fresh-Light Lunch Loyalist",      match: (v) => (v.flavor["fresh"] ?? 0) >= 3 && occShare(v, "working_lunch") >= 0.3 },
  { label: "Char-Forward Pilgrim",            match: (v) => (v.flavor["char"] ?? 0) >= 3 && v.geographicSpreadKm >= 5 },
  { label: "Premium Fast-Casual Patron",      match: (v) => formatShare(v, "fast_casual") >= 0.4 && v.averagePriceLevel >= 2.5 },
  { label: "Affordable-Eats Pragmatist",      match: (v) => v.averagePriceLevel <= 1.6 && v.visitCount >= 4 },
  { label: "Midweek Counter-Service Loyalist", match: (v) => formatShare(v, "quick_service") >= 0.4 && v.weekendShare <= 0.25 },
  { label: "Solo Diner Regular",              match: (v) => occShare(v, "casual_solo") >= 0.4 },
  { label: "Group-Dinner Socialite",          match: (v) => occShare(v, "group_dinner") >= 0.35 && v.weekendShare >= 0.45 },
  { label: "After-Work Cocktail Crew",        match: (v) => formatShare(v, "bar") >= 0.25 && v.weekendShare <= 0.4 },
  { label: "Sunday Slow-Brunch Loyalist",     match: (v) => occShare(v, "brunch") >= 0.3 && v.dowCounts[0] >= 2 },
  { label: "Saturday-Night Foodie",           match: (v) => v.dowCounts[6] >= 3 && v.averagePriceLevel >= 2.5 },
  { label: "Block-Radius Regular",            match: (v) => v.geographicSpreadKm > 0 && v.geographicSpreadKm < 1 && v.visitCount >= 4 },
  { label: "Two-Spot Regular",                match: (v) => v.uniqueRestaurants <= 3 && v.visitCount >= 4 },
  { label: "Always-Trying Explorer",          match: (v) => v.uniqueRestaurants >= 8 && v.repeatRate <= 0.2 },
  { label: "Same-Order Loyalist",             match: (v) => v.uniqueRestaurants <= 4 && v.repeatRate >= 0.6 },
  { label: "Food Hall Regular",               match: (v) => formatShare(v, "market_hall") >= 0.15 },
  { label: "Hotel Bar Connoisseur",           match: (v) => formatShare(v, "hotel_dining") >= 0.15 },
  { label: "Delivery-Heavy Pragmatist",       match: (v) => formatShare(v, "ghost_kitchen") >= 0.3 },
  { label: "Casual Curiosity Eater",          match: (v) => v.uniqueRestaurants >= 4 && Object.keys(v.cuisineRegion).length >= 3 },
  { label: "Quiet Weeknight Regular",         match: (v) => v.weekendShare <= 0.25 && v.repeatRate >= 0.5 },
  { label: "Open-To-Anything Eater",          match: (v) => v.visitCount >= 4 && Object.keys(v.cuisineSubregion).length >= 4 },

  // ---- Universal floor ------------------------------------------------------
  { label: "Pattern Forming",                 match: (v) => v.visitCount > 0 },
  { label: "Just Getting Started",            match: () => true },
];

function fallback(v: TasteVector, opts?: { mood?: boolean }): PalateIdentity {
  const rules = opts?.mood ? FALLBACK_RULES.slice().reverse() : FALLBACK_RULES;
  // Mood reverses to favor lighter labels first, but still respects most-specific-first within zones.
  for (const rule of FALLBACK_RULES) {
    if (rule.match(v)) {
      return {
        label: rule.label,
        evidence: [opts?.mood ? "Snapshot of this week's pattern." : "Read off your overall pattern."],
        confidence: 0.4,
        source: "taxonomy",
      };
    }
  }
  // Should never reach this — universal floor exists.
  return {
    label: "Just Getting Started",
    evidence: ["Not enough data yet — log a few visits."],
    confidence: 0.1,
    source: "taxonomy",
  };
}

/** Exposed for diagnostics / admin. */
export const FALLBACK_LABEL_COUNT = FALLBACK_RULES.length;
