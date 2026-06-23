// Palate restaurant classifier — pure, dependency-free derivation logic.
//
// Imported by:
//   - supabase/functions/places-proxy/index.ts  (production edge function)
//   - supabase/eval/run.ts                       (eval harness)
//
// Keep this module side-effect free. No fetch(), no Deno.env reads, no DB
// access. That is what lets the eval runner exercise it in isolation.

export const CLASSIFIER_VERSION = "1.3.1";

// ----- Google place shape (subset we use) -------------------------------

export interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

export interface GoogleReview {
  text?: { text?: string };
}

export interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  priceLevel?: string;
  rating?: number;
  userRatingCount?: number;
  editorialSummary?: { text?: string };
  reviews?: GoogleReview[];
}

// ----- Derived classification shape -------------------------------------

export interface DerivedClassification {
  cuisine_type: string | null;
  cuisine_region: string | null;
  cuisine_subregion: string | null;
  format_class: string;
  chain_name: string | null;
  chain_type: string;
  occasion_tags: string[];
  flavor_tags: string[];
  cultural_context: string;
  tags: string[];
  // 0..1. 0 = never recommend (McDonald's, airports, hotels, lounges).
  // 1 = full discovery candidate. Soft downranks land in between.
  recommendation_eligibility: number;
  // Single-word reason when eligibility < 1 — surfaced in the eval / admin
  // tools so we can audit "why didn't this place appear?"
  ineligibility_reason: string | null;
  // Per-field confidence in [0, 1]. Only emitted for scalar fields where the
  // notion of "confidence" makes sense. Array fields (occasion_tags etc.) are
  // not included because each tag has its own derivation path.
  // Consumed by:
  //   - LLM fallback (fires when cuisine_type confidence < threshold)
  //   - Mobile UI (hides tags below a display threshold)
  //   - Eval (lets us report accuracy split by confidence band)
  confidence: ConfidenceMap;
}

export type ConfidenceField =
  | "cuisine_type"
  | "cuisine_region"
  | "cuisine_subregion"
  | "format_class"
  | "chain_type"
  | "cultural_context";

export type ConfidenceMap = Partial<Record<ConfidenceField, number>>;

export const PRICE_LEVEL_MAP: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

// ----- Cuisine inference from Google types[] ----------------------------

export const CUISINE_TYPE_MAP: Record<string, string> = {
  american_restaurant: "american",
  hamburger_restaurant: "american",
  fast_food_restaurant: "american",
  sandwich_shop: "american",
  italian_restaurant: "italian",
  pizza_restaurant: "italian",
  chinese_restaurant: "chinese",
  japanese_restaurant: "japanese",
  sushi_restaurant: "japanese",
  ramen_restaurant: "japanese",
  korean_restaurant: "korean",
  thai_restaurant: "thai",
  vietnamese_restaurant: "vietnamese",
  indian_restaurant: "indian",
  mexican_restaurant: "mexican",
  mediterranean_restaurant: "mediterranean",
  greek_restaurant: "mediterranean",
  middle_eastern_restaurant: "middle-eastern",
  french_restaurant: "french",
  spanish_restaurant: "spanish",
  steak_house: "steakhouse",
  seafood_restaurant: "seafood",
  barbecue_restaurant: "bbq",
  brunch_restaurant: "brunch",
  breakfast_restaurant: "brunch",
  vegan_restaurant: "healthy",
  vegetarian_restaurant: "healthy",
  ice_cream_shop: "dessert",
  donut_shop: "bakery",
  bakery: "bakery",
  coffee_shop: "café",
  cafe: "café",
  wine_bar: "bar",
  pub: "bar",
  bar: "bar",
};

export function inferCuisineFromTypes(types: string[]): string | null {
  return inferCuisineFromTypesWithConfidence(types)[0];
}

// Returns [cuisine, confidence]. Specific `*_restaurant` and `*_shop` types
// signal cuisine strongly (Google explicitly classified the place); generic
// `cafe`, `bar`, `pub`, `bakery` types are weaker hints because they overlap
// with format and not cuisine.
export function inferCuisineFromTypesWithConfidence(types: string[]): [string | null, number] {
  for (const t of types) {
    const c = CUISINE_TYPE_MAP[t];
    if (!c) continue;
    const isSpecific = t.endsWith("_restaurant") || t.endsWith("_shop") || t === "steak_house" || t === "bakery";
    return [c, isSpecific ? 0.95 : 0.65];
  }
  return [null, 0];
}

// ----- Subregion / region rules (ordered, first match wins) -------------

export const SUBREGION_RULES: Array<{
  match: (name: string, types: string[]) => boolean;
  subregion: string;
  region: string;
}> = [
  // Southern US BBQ
  { match: (n) => /memphis/i.test(n) && /bbq|smoke|rib/i.test(n),  subregion: "memphis_bbq",   region: "southern_us" },
  { match: (n) => /(kansas city|k\.c\.) ?bbq/i.test(n),            subregion: "kc_bbq",        region: "southern_us" },
  { match: (n) => /texas|brisket/i.test(n) && /bbq|smoke/i.test(n),subregion: "texas_bbq",     region: "southern_us" },
  { match: (n) => /nashville hot/i.test(n),                        subregion: "nashville_hot", region: "southern_us" },
  { match: (n) => /cajun|creole|gumbo/i.test(n),                   subregion: "cajun",         region: "southern_us" },
  { match: (n) => /soul ?food|chicken & waffles/i.test(n),         subregion: "soul_food",     region: "southern_us" },
  // Korean
  { match: (n, t) => t.includes("korean_restaurant") && /bbq|kbbq|gogi|ssam/i.test(n), subregion: "korean_bbq", region: "east_asian" },
  { match: (_, t) => t.includes("korean_restaurant"),              subregion: "korean",        region: "east_asian" },
  // Japanese
  { match: (_, t) => t.includes("ramen_restaurant"),               subregion: "japanese_ramen", region: "east_asian" },
  { match: (_, t) => t.includes("sushi_restaurant"),               subregion: "japanese_sushi", region: "east_asian" },
  { match: (n) => /izakaya|yakitori|sake bar/i.test(n),            subregion: "japanese_izakaya", region: "east_asian" },
  { match: (_, t) => t.includes("japanese_restaurant"),            subregion: "japanese",      region: "east_asian" },
  // Chinese regional
  { match: (n) => /sichuan|szechuan|chongqing|chengdu/i.test(n),   subregion: "chinese_szechuan", region: "east_asian" },
  { match: (n) => /cantonese|dim sum|hk |hong kong/i.test(n),      subregion: "chinese_cantonese", region: "east_asian" },
  { match: (n) => /xian|xi'an|biang biang|hand-pulled/i.test(n),   subregion: "chinese_xian",  region: "east_asian" },
  { match: (n) => /taiwanese|boba|bubble tea/i.test(n),            subregion: "taiwanese",     region: "east_asian" },
  { match: (_, t) => t.includes("chinese_restaurant"),             subregion: "chinese",       region: "east_asian" },
  // Vietnamese
  { match: (n) => /pho/i.test(n),                                  subregion: "vietnamese_pho", region: "east_asian" },
  { match: (n) => /banh mi|bánh mì/i.test(n),                      subregion: "vietnamese_banh_mi", region: "east_asian" },
  { match: (_, t) => t.includes("vietnamese_restaurant"),          subregion: "vietnamese",    region: "east_asian" },
  // Thai
  { match: (_, t) => t.includes("thai_restaurant"),                subregion: "thai",          region: "east_asian" },
  // South Asian
  { match: (n) => /south indian|dosa|idli/i.test(n),               subregion: "indian_south",  region: "south_asian" },
  { match: (n) => /pakistani|biryani|karahi/i.test(n),             subregion: "pakistani",     region: "south_asian" },
  { match: (n) => /bangladeshi|kolkata/i.test(n),                  subregion: "bangladeshi",   region: "south_asian" },
  { match: (_, t) => t.includes("indian_restaurant"),              subregion: "indian_north",  region: "south_asian" },
  // Middle Eastern / Halal
  { match: (n) => /halal cart|halal guys|halal food/i.test(n),     subregion: "halal_cart",    region: "middle_eastern" },
  { match: (n) => /persian|iranian|kebab house/i.test(n),          subregion: "persian",       region: "middle_eastern" },
  { match: (n) => /lebanese|shawarma/i.test(n),                    subregion: "lebanese",      region: "middle_eastern" },
  { match: (n) => /israeli|sabich|hummus/i.test(n),                subregion: "israeli",       region: "middle_eastern" },
  { match: (n) => /turkish|doner|adana/i.test(n),                  subregion: "turkish",       region: "middle_eastern" },
  { match: (_, t) => t.includes("middle_eastern_restaurant"),      subregion: "middle_eastern", region: "middle_eastern" },
  // Mediterranean
  { match: (_, t) => t.includes("greek_restaurant"),               subregion: "greek",         region: "mediterranean" },
  { match: (n) => /moroccan|tagine|couscous/i.test(n),             subregion: "moroccan",      region: "mediterranean" },
  { match: (_, t) => t.includes("mediterranean_restaurant"),       subregion: "mediterranean_general", region: "mediterranean" },
  // Italian — specific name patterns first; American pizza variants jump in
  // before the italian_pizzeria catch-all so e.g. "Joe's Pizza" lands in
  // pizza_nyc rather than the generic Italian bucket.
  { match: (n) => /neapolitan|pizzeria napoletana/i.test(n),       subregion: "italian_neapolitan", region: "italian" },
  { match: (n) => /trattoria|osteria/i.test(n),                    subregion: "italian_trattoria", region: "italian" },
  { match: (n, t) => t.includes("pizza_restaurant") && /(ny|new york|joe's)/i.test(n), subregion: "pizza_nyc", region: "american" },
  { match: (n) => /chicago deep dish|deep dish/i.test(n),          subregion: "pizza_chicago", region: "american" },
  { match: (_, t) => t.includes("pizza_restaurant"),               subregion: "italian_pizzeria", region: "italian" },
  { match: (_, t) => t.includes("italian_restaurant"),             subregion: "italian_general", region: "italian" },
  // Latin American
  { match: (n) => /taqueria|taco truck|el ?taco/i.test(n),         subregion: "mexican_taqueria", region: "latin_american" },
  { match: (n) => /oaxac|yucat|jalisco/i.test(n),                  subregion: "mexican_regional", region: "latin_american" },
  { match: (_, t) => t.includes("mexican_restaurant"),             subregion: "mexican",       region: "latin_american" },
  { match: (n) => /peruvian|ceviche|pollo a la brasa/i.test(n),    subregion: "peruvian",      region: "latin_american" },
  { match: (n) => /brazilian|churrasc/i.test(n),                   subregion: "brazilian",     region: "latin_american" },
  { match: (n) => /argentine|argentin/i.test(n),                   subregion: "argentine",     region: "latin_american" },
  { match: (n) => /cuban|cubano/i.test(n),                         subregion: "cuban",         region: "latin_american" },
  { match: (n) => /dominican|mofongo|sancocho/i.test(n),           subregion: "dominican",     region: "latin_american" },
  { match: (n) => /puerto rican|boricua/i.test(n),                 subregion: "puerto_rican",  region: "latin_american" },
  // Caribbean
  { match: (n) => /jamaican|jerk/i.test(n),                        subregion: "jamaican",      region: "caribbean" },
  { match: (n) => /trinidadian|trinidad|roti shop/i.test(n),       subregion: "trinidadian",   region: "caribbean" },
  { match: (n) => /haitian/i.test(n),                              subregion: "haitian",       region: "caribbean" },
  // African
  { match: (n) => /ethiopian|injera/i.test(n),                     subregion: "ethiopian",     region: "african" },
  { match: (n) => /nigerian|jollof|suya/i.test(n),                 subregion: "nigerian",      region: "african" },
  { match: (n) => /senegal/i.test(n),                              subregion: "senegalese",    region: "african" },
  // American formats
  { match: (n) => /diner/i.test(n),                                subregion: "american_diner", region: "american" },
  { match: (n) => /deli|jewish deli|pastrami/i.test(n),            subregion: "deli_jewish",   region: "american" },
  // (pizza_nyc + pizza_chicago moved up — see Italian block above)
  { match: (n) => /diner|breakfast|pancake/i.test(n),              subregion: "breakfast_diner", region: "american" },
  { match: (_, t) => t.includes("hamburger_restaurant"),           subregion: "burger",        region: "american" },
  { match: (n) => /bodega|corner store/i.test(n),                  subregion: "bodega_food",   region: "american" },
  // Bar / wine / fine dining
  { match: (n) => /wine bar|enoteca/i.test(n),                     subregion: "wine_bar_food", region: "european" },
  { match: (n) => /steakhouse|chop house/i.test(n),                subregion: "steakhouse",    region: "american" },
  { match: (n) => /seafood|oyster|raw bar/i.test(n),               subregion: "seafood_house", region: "american" },
  { match: (_, t) => t.includes("barbecue_restaurant"),            subregion: "bbq_general",   region: "southern_us" },
  { match: (n) => /brunch|breakfast/i.test(n),                     subregion: "brunch_modern", region: "american" },
  { match: (_, t) => t.includes("coffee_shop") || t.includes("cafe"), subregion: "café",       region: "café_culture" },
];

export function inferSubregion(
  name: string,
  types: string[],
): { subregion: string | null; region: string | null } {
  const { subregion, region } = inferSubregionWithConfidence(name, types);
  return { subregion, region };
}

// Generic catch-all subregions (the last rule in each cuisine block) carry
// lower confidence because they're rule-engine fallbacks, not specific signals.
const FALLBACK_SUBREGIONS = new Set([
  "chinese", "japanese", "korean", "thai", "vietnamese", "mexican",
  "italian_general", "mediterranean_general", "indian_north",
  "bbq_general", "middle_eastern", "café", "brunch_modern",
  "italian_pizzeria",
]);

export function inferSubregionWithConfidence(
  name: string,
  types: string[],
): { subregion: string | null; region: string | null; confidence: number } {
  for (const rule of SUBREGION_RULES) {
    if (rule.match(name, types)) {
      const confidence = FALLBACK_SUBREGIONS.has(rule.subregion) ? 0.5 : 0.9;
      return { subregion: rule.subregion, region: rule.region, confidence };
    }
  }
  return { subregion: null, region: null, confidence: 0 };
}

export function inferFormatClass(types: string[], priceLevel: number | null): string {
  return inferFormatClassWithConfidence(types, priceLevel)[0];
}

// Type-derived format (bar, café, ghost_kitchen, etc.) is high confidence —
// Google explicitly tagged the format. Price-derived format is medium because
// price tier is a proxy. The default `fast_casual` is a guess.
export function inferFormatClassWithConfidence(
  types: string[],
  priceLevel: number | null,
): [string, number] {
  if (types.includes("bar") || types.includes("pub")) return ["bar", 0.95];
  if (types.includes("wine_bar")) return ["wine_bar", 0.95];
  if (types.includes("coffee_shop") || types.includes("cafe")) return ["café", 0.95];
  if (types.includes("meal_delivery")) return ["ghost_kitchen", 0.9];
  if (types.includes("meal_takeaway")) return ["quick_service", 0.85];
  if (types.includes("fast_food_restaurant")) return ["quick_service", 0.9];
  if (priceLevel != null && priceLevel >= 4) return ["fine_dining", 0.7];
  if (priceLevel != null && priceLevel >= 3) return ["casual_dining", 0.6];
  if (priceLevel != null && priceLevel <= 1) return ["quick_service", 0.6];
  return ["fast_casual", 0.3];
}

export const NATIONAL_CHAINS = new Set([
  "Starbucks", "McDonald's", "Subway", "Chipotle", "Chick-fil-A",
  "Shake Shack", "Sweetgreen", "Dunkin", "Panera", "Five Guys",
  "Taco Bell", "Wendy's", "Burger King", "Popeyes", "Cava", "Pret",
]);

export const KNOWN_CHAINS = [
  "Starbucks", "McDonald's", "Chipotle", "Sweetgreen", "Chick-fil-A",
  "Shake Shack", "Subway", "Dunkin", "Panera", "Five Guys", "In-N-Out",
  "Taco Bell", "Wendy's", "Burger King", "Popeyes", "Cava", "Pret",
  "Whole Foods", "Trader Joe's",
];

export function detectChain(name: string): string | null {
  for (const c of KNOWN_CHAINS) {
    if (name.toLowerCase().startsWith(c.toLowerCase())) return c;
  }
  return null;
}

export function inferChainType(name: string, chainName: string | null): string {
  return inferChainTypeWithConfidence(name, chainName)[0];
}

// Known-chain lookups are high signal. Independent classification is the
// absence of a match, which is medium confidence (could be a chain we
// haven't seen). The name-heuristic local_chain detection is shakier.
export function inferChainTypeWithConfidence(
  name: string,
  chainName: string | null,
): [string, number] {
  if (chainName) {
    if (NATIONAL_CHAINS.has(chainName)) return ["national_chain", 0.95];
    if (/(\bgroup\b|\bco\.|\& sons|\bbrothers\b)/i.test(name)) return ["local_chain", 0.55];
    return ["regional_chain", 0.55];
  }
  return ["independent", 0.6];
}

export function inferOccasionTags(
  formatClass: string,
  priceLevel: number | null,
  types: string[],
): string[] {
  const tags = new Set<string>();
  const price = priceLevel ?? 2;
  if (formatClass === "fine_dining" || price >= 3) {
    tags.add("date_night");
    tags.add("group_dinner");
  }
  if (formatClass === "bar" || formatClass === "wine_bar") {
    tags.add("late_night");
    tags.add("group_dinner");
  }
  if (formatClass === "café") {
    tags.add("breakfast");
    tags.add("working_lunch");
  }
  if (formatClass === "quick_service") {
    tags.add("casual_solo");
    tags.add("working_lunch");
  }
  if (types.includes("brunch_restaurant") || types.includes("breakfast_restaurant")) {
    tags.add("brunch");
    tags.add("weekend_anchor");
  }
  return [...tags];
}

export function inferFlavorTags(cuisine: string | null, subregion: string | null): string[] {
  const tags = new Set<string>();
  if (subregion?.includes("bbq") || subregion === "memphis_bbq" || subregion === "kc_bbq" || subregion === "texas_bbq") {
    tags.add("smoky"); tags.add("char"); tags.add("rich");
  }
  if (cuisine === "mexican" || cuisine === "thai" || cuisine === "indian" || cuisine === "korean") tags.add("spicy");
  if (subregion === "nashville_hot" || subregion === "chinese_szechuan") tags.add("spicy");
  if (cuisine === "japanese" || subregion === "japanese_ramen" || subregion?.includes("korean")) {
    tags.add("umami"); tags.add("savory");
  }
  if (cuisine === "healthy" || subregion === "japanese_sushi") { tags.add("fresh"); tags.add("light"); }
  if (cuisine === "bakery" || cuisine === "dessert") tags.add("sweet");
  if (cuisine === "italian" || cuisine === "american" || cuisine === "bbq" || cuisine === "steakhouse") tags.add("rich");
  return [...tags];
}

export function inferCulturalContext(
  chainType: string,
  priceLevel: number | null,
  ratingCount: number | null,
): string {
  return inferCulturalContextWithConfidence(chainType, priceLevel, ratingCount)[0];
}

// Cultural context is the most editorial field — every assignment here is a
// heuristic. Cap confidence at ~0.7 so the LLM fallback can override later.
export function inferCulturalContextWithConfidence(
  chainType: string,
  priceLevel: number | null,
  ratingCount: number | null,
): [string, number] {
  if (chainType === "national_chain") return ["comfort", 0.7];
  if (priceLevel != null && priceLevel >= 4) return ["modernist", 0.55];
  if (ratingCount != null && ratingCount < 50) return ["hidden", 0.5];
  if (ratingCount != null && ratingCount > 5000) return ["trending", 0.5];
  return ["heritage", 0.3];
}

export function deriveTags(
  cuisine: string | null,
  primaryType: string | null,
  priceLevel: number | null,
): string[] {
  const tags = new Set<string>();
  const price = priceLevel ?? 2;

  if (cuisine === "mexican" || cuisine === "thai" || cuisine === "indian" || cuisine === "korean") tags.add("spicy");
  if (cuisine === "japanese" || cuisine === "seafood") tags.add("seafood");
  if (cuisine === "healthy") tags.add("healthy");
  if (cuisine === "bakery" || cuisine === "dessert") { tags.add("sweet"); tags.add("brunch"); }
  if (cuisine === "café") { tags.add("café"); tags.add("brunch"); }
  if (cuisine === "italian" || cuisine === "american" || cuisine === "bbq") tags.add("comfort");
  if (cuisine === "steakhouse") { tags.add("upscale"); tags.add("date-night"); }
  if (cuisine === "chinese" || cuisine === "korean" || cuisine === "indian") tags.add("shareable");

  switch (primaryType) {
    case "bar":           tags.add("late-night"); tags.add("group-friendly"); break;
    case "meal_takeaway":
    case "meal_delivery": tags.add("quick-service"); break;
    case "cafe":          tags.add("café"); break;
  }

  if (price >= 3) { tags.add("upscale"); tags.add("date-night"); }
  if (price <= 1) tags.add("casual");

  return [...tags];
}

export function neighborhoodFromPlace(p: GooglePlace): string | null {
  const comps = p.addressComponents ?? [];
  const byType = (t: string) =>
    comps.find((c) => c.types?.includes(t))?.longText ?? null;
  return (
    byType("neighborhood") ||
    byType("sublocality_level_1") ||
    byType("sublocality") ||
    byType("locality") ||
    fallbackNeighborhood(p.formattedAddress ?? p.shortFormattedAddress ?? null)
  );
}

function fallbackNeighborhood(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 3] ?? null;
  if (parts.length === 2) return parts[0] ?? null;
  return null;
}

// ----- Review-text mining (flavor + occasion tags) ----------------------
// Regex patterns over user reviews / editorial summary. One match in any
// snippet is enough — reviews are short and explicit signals matter. We
// only add tags that aren't already present, so this only ever broadens.

const REVIEW_FLAVOR_PATTERNS: Array<[string, RegExp]> = [
  ["spicy",  /\b(spicy|spice level|hot sauce|burns|szechuan peppercorn|chili|chile|fiery|tongue[- ]numbing|sweat)\b/i],
  ["smoky",  /\b(smoky|smokey|smoked|wood[- ]fire|wood[- ]fired)\b/i],
  ["char",   /\b(charred|char[- ]grilled|grill marks|burnt edges)\b/i],
  ["sweet",  /\b(sweet|dessert|sugary|honeyed|maple syrup|caramelized)\b/i],
  ["umami",  /\b(umami|broth|dashi|savory depth|complex broth)\b/i],
  ["savory", /\b(savory|hearty|comforting|salty)\b/i],
  ["fresh",  /\b(fresh|crisp|crunchy|just[- ]picked|farm[- ]to[- ]table)\b/i],
  ["light",  /\b(light|delicate|airy|refreshing)\b/i],
  ["rich",   /\b(rich|creamy|buttery|decadent|indulgent|heavy)\b/i],
];

const REVIEW_OCCASION_PATTERNS: Array<[string, RegExp]> = [
  ["date_night",      /\b(date night|romantic|anniversary|intimate|cozy|candle[- ]?lit)\b/i],
  ["group_dinner",    /\b(family[- ]style|shareable|big group|large group|good for groups|family friendly)\b/i],
  ["brunch",          /\b(brunch|mimosa|bottomless|weekend brunch|brunch spot)\b/i],
  ["late_night",      /\b(late night|after work drinks|2 ?am|midnight|bar food)\b/i],
  ["breakfast",       /\b(breakfast|early morning|first thing|pancakes|eggs and)\b/i],
  ["working_lunch",   /\b(working lunch|business lunch|meeting|quick lunch|in and out fast)\b/i],
  ["weekend_anchor",  /\b(weekend institution|saturday morning|sunday tradition|always packed weekends)\b/i],
];

export interface ReviewMiningResult {
  flavor_tags: string[];
  occasion_tags: string[];
}

export function mineFromReviewSnippets(snippets: string[]): ReviewMiningResult {
  const corpus = snippets.join("\n").toLowerCase();
  if (!corpus) return { flavor_tags: [], occasion_tags: [] };

  const flavor: string[] = [];
  for (const [tag, pat] of REVIEW_FLAVOR_PATTERNS) {
    if (pat.test(corpus)) flavor.push(tag);
  }
  const occasion: string[] = [];
  for (const [tag, pat] of REVIEW_OCCASION_PATTERNS) {
    if (pat.test(corpus)) occasion.push(tag);
  }
  return { flavor_tags: flavor, occasion_tags: occasion };
}

// ----- Recommendation eligibility ---------------------------------------
// Decides whether a place should ever appear in a discovery feed. Hard
// excludes for places users either can't access (airports, members-only
// lounges) or don't need surfaced (national chains — they already know
// Starbucks exists). Soft downranks for regional chains.
//
// This is intentionally aggressive: a missed great place is recoverable
// (user can search by name), but a feed full of McDonald's burns trust.

export interface EligibilityResult {
  eligibility: number;
  reason: string | null;
}

export function inferRecommendationEligibility(
  place: GooglePlace,
  derived: { chain_type: string; cuisine_type: string | null; format_class: string },
): EligibilityResult {
  const types = place.types ?? [];
  const name = (place.displayName?.text ?? "").toLowerCase();
  const address = (place.formattedAddress ?? place.shortFormattedAddress ?? "").toLowerCase();

  // ---- HARD EXCLUDES (eligibility = 0) ----

  // Airports: by Google type, address keyword, or "terminal X" pattern
  if (types.includes("airport")) {
    return { eligibility: 0, reason: "airport" };
  }
  if (/\b(airport|airfield)\b/.test(address)) {
    return { eligibility: 0, reason: "airport" };
  }
  if (/\bterminal\s+[a-z0-9]/i.test(address) || /\bgate\s+\d/i.test(address)) {
    return { eligibility: 0, reason: "airport" };
  }

  // Lounges — excluded from discovery entirely. Gated lounges (airport clubs,
  // members-only) get a more specific reason, but ALL lounges are dropped:
  // they're bars / bottle-service spots, not the restaurants Palate surfaces.
  if (/\blounge\b/.test(name)) {
    const gated = /\b(members|airport|terminal|club|priority pass|admirals|centurion)\b/.test(name)
      || /\b(airport|terminal)\b/.test(address);
    return { eligibility: 0, reason: gated ? "lounge_gated" : "lounge" };
  }

  // Hotels — when the place IS a hotel rather than a destination restaurant.
  // Heuristic: primaryType=lodging (Google thinks it's a hotel first), or
  // `lodging` in types AND no specific cuisine inferred (generic hotel dining).
  if (place.primaryType === "lodging") {
    return { eligibility: 0, reason: "hotel" };
  }
  if (types.includes("lodging") && derived.cuisine_type === null) {
    return { eligibility: 0, reason: "hotel_generic" };
  }

  // Fast food — Google's explicit fast_food_restaurant type (the
  // McDonald's / Burger King tier). Independent cheap eats are NOT caught
  // here (they keep eligibility), so the discovery feed loses true fast
  // food without nuking great low-price local spots.
  if (types.includes("fast_food_restaurant")) {
    return { eligibility: 0, reason: "fast_food" };
  }

  // National chains — across all formats. A discovery feed shouldn't push
  // Starbucks, McDonald's, Chipotle, Sweetgreen, Panera, etc. Users who
  // want them can search by name.
  if (derived.chain_type === "national_chain") {
    return { eligibility: 0, reason: "national_chain" };
  }

  // ---- SOFT DOWNRANK ----

  if (derived.chain_type === "regional_chain") {
    return { eligibility: 0.7, reason: "regional_chain" };
  }
  if (derived.chain_type === "local_chain") {
    return { eligibility: 0.85, reason: "local_chain" };
  }

  return { eligibility: 1.0, reason: null };
}

// ----- Top-level derivation (pure) --------------------------------------

export function deriveClassification(p: GooglePlace): DerivedClassification {
  const name = p.displayName?.text ?? "Unknown";
  const types = p.types ?? [];
  const primaryType = p.primaryType ?? types[0] ?? null;
  const price = p.priceLevel ? PRICE_LEVEL_MAP[p.priceLevel] ?? null : null;

  const [cuisine, cuisineConf] = inferCuisineFromTypesWithConfidence(types);
  const { subregion, region, confidence: subregionConf } = inferSubregionWithConfidence(name, types);
  const [formatClass, formatConf] = inferFormatClassWithConfidence(types, price);
  const chainName = detectChain(name);
  const [chainType, chainConf] = inferChainTypeWithConfidence(name, chainName);
  const [culturalContext, culturalConf] = inferCulturalContextWithConfidence(
    chainType,
    price,
    p.userRatingCount ?? null,
  );

  // Region confidence inherits from subregion — they're computed together.
  // When no subregion fires, region falls back to whatever the cuisine type
  // implies (low signal, hence the lower number).
  const regionConf = subregionConf > 0 ? subregionConf : cuisine ? 0.4 : 0;

  // Augment tags from review text / editorial summary when present. The
  // miner only ever broadens, never overrides.
  const reviewCorpus: string[] = [];
  if (p.editorialSummary?.text) reviewCorpus.push(p.editorialSummary.text);
  for (const r of p.reviews ?? []) {
    if (r.text?.text) reviewCorpus.push(r.text.text);
  }
  const mined = mineFromReviewSnippets(reviewCorpus);

  const baseOccasion = inferOccasionTags(formatClass, price, types);
  const baseFlavor = inferFlavorTags(cuisine, subregion);
  const occasionTags = Array.from(new Set([...baseOccasion, ...mined.occasion_tags]));
  const flavorTags = Array.from(new Set([...baseFlavor, ...mined.flavor_tags]));

  const elig = inferRecommendationEligibility(p, {
    chain_type: chainType,
    cuisine_type: cuisine,
    format_class: formatClass,
  });

  return {
    cuisine_type: cuisine,
    cuisine_region: region,
    cuisine_subregion: subregion,
    format_class: formatClass,
    chain_name: chainName,
    chain_type: chainType,
    occasion_tags: occasionTags,
    flavor_tags: flavorTags,
    cultural_context: culturalContext,
    tags: deriveTags(cuisine, primaryType, price),
    recommendation_eligibility: elig.eligibility,
    ineligibility_reason: elig.reason,
    confidence: {
      cuisine_type: cuisineConf,
      cuisine_region: regionConf,
      cuisine_subregion: subregionConf,
      format_class: formatConf,
      chain_type: chainConf,
      cultural_context: culturalConf,
    },
  };
}

// ----- DB row builder (used by places-proxy edge function) --------------

export function googleToRestaurantRow(
  p: GooglePlace,
  // If provided, use this derivation instead of computing one. Callers pass
  // this in after merging LLM suggestions into the deterministic result.
  derivedOverride?: DerivedClassification,
) {
  const name = p.displayName?.text ?? "Unknown";
  const types = p.types ?? [];
  const primaryType = p.primaryType ?? types[0] ?? null;
  const price = p.priceLevel ? PRICE_LEVEL_MAP[p.priceLevel] ?? null : null;
  const d = derivedOverride ?? deriveClassification(p);

  return {
    google_place_id: p.id,
    name,
    chain_name: d.chain_name,
    address: p.shortFormattedAddress ?? p.formattedAddress ?? null,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    primary_type: primaryType,
    types: types.length ? types : null,
    cuisine_type: d.cuisine_type,
    cuisine_region: d.cuisine_region,
    cuisine_subregion: d.cuisine_subregion,
    format_class: d.format_class,
    chain_type: d.chain_type,
    occasion_tags: d.occasion_tags.length ? d.occasion_tags : null,
    flavor_tags: d.flavor_tags.length ? d.flavor_tags : null,
    cultural_context: d.cultural_context,
    neighborhood: neighborhoodFromPlace(p),
    tags: d.tags.length ? d.tags : null,
    price_level: price,
    rating: p.rating ?? null,
    user_rating_count: p.userRatingCount ?? null,
    refreshed_at: new Date().toISOString(),
    classifier_version: CLASSIFIER_VERSION,
    classification_confidence: d.confidence,
    recommendation_eligibility: d.recommendation_eligibility,
    ineligibility_reason: d.ineligibility_reason,
  };
}
