// Palate restaurant classifier — pure, dependency-free derivation logic.
//
// Imported by:
//   - supabase/functions/places-proxy/index.ts  (production edge function)
//   - supabase/eval/run.ts                       (eval harness)
//
// Keep this module side-effect free. No fetch(), no Deno.env reads, no DB
// access. That is what lets the eval runner exercise it in isolation.

export const CLASSIFIER_VERSION = "1.4.0";

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
  // Google "atmosphere" attributes — booleans Google already computes. Present
  // only on the Details call (same paid SKU as reviews, so no extra cost). They
  // are strong DETERMINISTIC occasion/vibe signal, no LLM needed.
  goodForGroups?: boolean;
  goodForChildren?: boolean;
  menuForChildren?: boolean;
  goodForWatchingSports?: boolean;
  liveMusic?: boolean;
  reservable?: boolean;
  outdoorSeating?: boolean;
  servesBreakfast?: boolean;
  servesBrunch?: boolean;
  servesLunch?: boolean;
  servesDinner?: boolean;
  servesBeer?: boolean;
  servesWine?: boolean;
  servesCocktails?: boolean;
  servesVegetarianFood?: boolean;
  servesDessert?: boolean;
  allowsDogs?: boolean;
  delivery?: boolean;
  takeout?: boolean;
  dineIn?: boolean;
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
  // ----- Qualitative "feel" tags -----------------------------------------
  // The attributes Google Places can't express — vibe, who's in the room,
  // how the menu eats, and whether it feels worth the money. These are
  // LLM-derived: the deterministic rules can't read a room from types[], so
  // they leave these null/empty and the LLM layer fills them in.
  //   vibe         : single dominant atmosphere
  //   crowd_energy : 0-3 tags describing who's there
  //   menu_style   : how the food is structured/served
  //   price_feel   : perceived value, independent of raw price_level
  //   ambiance_notes: one short free-text sentence (max ~15 words)
  vibe: string | null;
  crowd_energy: string[];
  menu_style: string | null;
  price_feel: string | null;
  ambiance_notes: string | null;
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
  bar_and_grill: "american",
  italian_restaurant: "italian",
  pizza_restaurant: "italian",
  chinese_restaurant: "chinese",
  japanese_restaurant: "japanese",
  sushi_restaurant: "japanese",
  ramen_restaurant: "japanese",
  korean_restaurant: "korean",
  thai_restaurant: "thai",
  vietnamese_restaurant: "vietnamese",
  indonesian_restaurant: "indonesian",
  filipino_restaurant: "filipino",
  indian_restaurant: "indian",
  afghani_restaurant: "middle-eastern",
  mexican_restaurant: "mexican",
  mediterranean_restaurant: "mediterranean",
  greek_restaurant: "mediterranean",
  turkish_restaurant: "middle-eastern",
  lebanese_restaurant: "middle-eastern",
  middle_eastern_restaurant: "middle-eastern",
  french_restaurant: "french",
  spanish_restaurant: "spanish",
  brazilian_restaurant: "latin-american",
  african_restaurant: "african",
  steak_house: "steakhouse",
  seafood_restaurant: "seafood",
  barbecue_restaurant: "bbq",
  brunch_restaurant: "brunch",
  breakfast_restaurant: "brunch",
  vegan_restaurant: "healthy",
  vegetarian_restaurant: "healthy",
  ice_cream_shop: "dessert",
  dessert_restaurant: "dessert",
  acai_shop: "healthy",
  donut_shop: "bakery",
  bagel_shop: "bakery",
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
  { match: (n) => /\bph[oở]\b/i.test(n),                           subregion: "vietnamese_pho", region: "east_asian" },
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
  { match: (n) => /israeli|sabich/i.test(n),                       subregion: "israeli",       region: "middle_eastern" },
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
  { match: (n) => /breakfast|pancake|flapjack|waffle house|egg\b/i.test(n), subregion: "breakfast_diner", region: "american" },
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

// Every subregion maps back to a broad cuisine_type. This is the fallback that
// keeps cuisine and subregion from ever disagreeing: when the Google types[]
// don't yield a cuisine but a name-based subregion rule fires (e.g. "Sichuan
// Impression" typed only as `restaurant`), we backfill cuisine_type from the
// subregion instead of leaving it null.
export const SUBREGION_TO_CUISINE: Record<string, string> = {
  memphis_bbq: "bbq", kc_bbq: "bbq", texas_bbq: "bbq", bbq_general: "bbq",
  nashville_hot: "bbq",
  cajun: "american", soul_food: "american",
  korean_bbq: "korean", korean: "korean",
  japanese_ramen: "japanese", japanese_sushi: "japanese",
  japanese_izakaya: "japanese", japanese: "japanese",
  chinese_szechuan: "chinese", chinese_cantonese: "chinese",
  chinese_xian: "chinese", taiwanese: "chinese", chinese: "chinese",
  vietnamese_pho: "vietnamese", vietnamese_banh_mi: "vietnamese",
  vietnamese: "vietnamese",
  thai: "thai",
  indian_south: "indian", indian_north: "indian",
  pakistani: "indian", bangladeshi: "indian",
  halal_cart: "middle-eastern", persian: "middle-eastern",
  lebanese: "middle-eastern", israeli: "middle-eastern",
  turkish: "middle-eastern", middle_eastern: "middle-eastern",
  greek: "mediterranean", moroccan: "mediterranean",
  mediterranean_general: "mediterranean",
  italian_neapolitan: "italian", italian_trattoria: "italian",
  italian_pizzeria: "italian", italian_general: "italian",
  pizza_nyc: "italian", pizza_chicago: "italian",
  mexican_taqueria: "mexican", mexican_regional: "mexican", mexican: "mexican",
  peruvian: "latin-american", brazilian: "latin-american",
  argentine: "latin-american", cuban: "latin-american",
  dominican: "latin-american", puerto_rican: "latin-american",
  jamaican: "caribbean", trinidadian: "caribbean", haitian: "caribbean",
  ethiopian: "african", nigerian: "african", senegalese: "african",
  american_diner: "american", deli_jewish: "american",
  breakfast_diner: "american", burger: "american", bodega_food: "american",
  wine_bar_food: "bar", steakhouse: "steakhouse", seafood_house: "seafood",
  brunch_modern: "brunch", "café": "café",
};

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

// Chains a discovery app should never surface — the brands users already know
// and would not be delighted to "discover." Spans fast food, fast casual,
// national coffee/bakery, casual-dining sit-down chains, pizza chains, and
// dessert/smoothie chains. Matched case- and punctuation-insensitively as a
// whole phrase anywhere in the name (so "SF Chipotle" and "Chipotle Mexican
// Grill" both hit). Curated toward unambiguous brand names to avoid clobbering
// independents that happen to share a common word.
export const CHAIN_BRANDS: string[] = [
  // Burgers / fast food
  "McDonald's", "Burger King", "Wendy's", "In-N-Out", "Five Guys",
  "Shake Shack", "Whataburger", "Culver's", "Carl's Jr", "Hardee's",
  "Jack in the Box", "White Castle", "Sonic Drive-In", "Checkers", "Rally's",
  "Smashburger", "Steak 'n Shake", "Fatburger", "The Habit Burger",
  // Chicken
  "Chick-fil-A", "Popeyes", "KFC", "Raising Cane's", "Zaxby's", "Bojangles",
  "Church's Chicken", "Wingstop", "Buffalo Wild Wings", "El Pollo Loco",
  "Dave's Hot Chicken", "Chester's",
  // Mexican / TexMex fast
  "Taco Bell", "Chipotle", "Qdoba", "Moe's Southwest", "Del Taco",
  "Taco Cabana", "Baja Fresh", "Rubio's", "On The Border",
  // Sandwiches / subs / delis
  "Subway", "Jimmy John's", "Jersey Mike's", "Firehouse Subs", "Quiznos",
  "Potbelly", "Which Wich", "Blimpie", "Schlotzsky's", "Arby's", "Jason's Deli",
  "McAlister's Deli",
  // Fast-casual bowls / salads / healthy
  "Sweetgreen", "Cava", "Chopt", "Just Salad", "Dig Inn", "Panera",
  "Freshii", "Tender Greens", "Mendocino Farms", "Noodles & Company",
  "Panda Express", "Pei Wei", "Pieology", "Blaze Pizza", "MOD Pizza",
  "&pizza", "Sarku Japan",
  // Coffee / bakery / snacks
  "Starbucks", "Dunkin", "Tim Hortons", "Peet's Coffee", "Caribou Coffee",
  "Pret A Manger", "Le Pain Quotidien", "Corner Bakery", "Panera Bread",
  "Auntie Anne's", "Cinnabon", "Krispy Kreme", "Einstein Bros",
  "The Coffee Bean", "Dutch Bros", "Philz Coffee",
  // Pizza chains
  "Domino's", "Pizza Hut", "Papa John's", "Little Caesars", "Papa Murphy's",
  "Round Table Pizza", "Marco's Pizza", "California Pizza Kitchen",
  // Casual-dining sit-down chains
  "Olive Garden", "Applebee's", "Chili's", "TGI Fridays", "Red Lobster",
  "Outback Steakhouse", "Texas Roadhouse", "LongHorn Steakhouse",
  "The Cheesecake Factory", "IHOP", "Denny's", "Waffle House", "Cracker Barrel",
  "Red Robin", "P.F. Chang's", "Cheddar's", "Ruby Tuesday", "Friendly's",
  "Perkins", "Bob Evans", "Golden Corral", "Hooters", "Dave & Buster's",
  "Maggiano's", "Carrabba's", "Bonefish Grill", "Yard House", "BJ's Restaurant",
  "Benihana", "Buca di Beppo", "Bahama Breeze", "Miller's Ale House",
  // Dessert / smoothie / ice cream
  "Baskin-Robbins", "Dairy Queen", "Cold Stone", "Ben & Jerry's",
  "Jamba", "Smoothie King", "Menchie's", "TCBY", "Häagen-Dazs", "Insomnia Cookies",
  // Grocers/markets sometimes typed as restaurants
  "Whole Foods", "Trader Joe's",
];

// Back-compat aliases (nothing else imports these, but keep the symbols).
export const NATIONAL_CHAINS = new Set(CHAIN_BRANDS);
export const KNOWN_CHAINS = CHAIN_BRANDS;

// Normalize a name for chain comparison: lowercase, strip punctuation/diacritics,
// collapse whitespace. "Chick-fil-A" and "chick fil a" both become "chick fil a".
function normalizeForChain(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const CHAIN_NORMALIZED: Array<[string, string]> = CHAIN_BRANDS.map(
  (b) => [b, normalizeForChain(b)],
);

// Detect a known chain anywhere in the name (as a bounded phrase), not just as
// a prefix — so location-prefixed and suffixed variants ("Downtown Chipotle",
// "Chipotle Mexican Grill") are caught. Returns the canonical brand name.
export function detectChain(name: string): string | null {
  const norm = ` ${normalizeForChain(name)} `;
  for (const [brand, token] of CHAIN_NORMALIZED) {
    if (norm.includes(` ${token} `)) return brand;
  }
  return null;
}

export function inferChainType(name: string, chainName: string | null): string {
  return inferChainTypeWithConfidence(name, chainName)[0];
}

// Any brand on the curated list is a national chain (hard-excluded downstream).
// Everything else is treated as independent — the discovery-positive default.
// We intentionally dropped the noisy name-heuristic ("Group", "Brothers", …)
// that used to mislabel single independents as local chains.
export function inferChainTypeWithConfidence(
  _name: string,
  chainName: string | null,
): [string, number] {
  if (chainName) return ["national_chain", 0.95];
  return ["independent", 0.6];
}

export function inferOccasionTags(
  formatClass: string,
  priceLevel: number | null,
  types: string[],
): string[] {
  const tags = new Set<string>();
  const price = priceLevel ?? 2;
  // Top-tier price/format reads as an occasion destination: dates, celebrations
  // (graduations, anniversaries), and serious business dinners.
  if (formatClass === "fine_dining" || price >= 4) {
    tags.add("date_night");
    tags.add("celebration");
    tags.add("business_dinner");
  }
  if (formatClass === "casual_dining" || price === 3) {
    tags.add("date_night");
    tags.add("group_dinner");
  }
  if (formatClass === "bar" || formatClass === "wine_bar") {
    tags.add("late_night");
    tags.add("party");
    tags.add("group_dinner");
  }
  if (formatClass === "café") {
    tags.add("breakfast");
    tags.add("working_lunch");
  }
  if (formatClass === "quick_service") {
    tags.add("casual_solo");
    tags.add("quick_bite");
    tags.add("working_lunch");
  }
  if (types.includes("brunch_restaurant") || types.includes("breakfast_restaurant")) {
    tags.add("brunch");
    tags.add("weekend_anchor");
  }
  return [...tags];
}

// Map Google's structured "atmosphere" booleans into deterministic occasion /
// crowd / vibe / tag signals. This is high-quality, zero-cost, zero-LLM signal
// — Google already computed these — and it's exactly the occasion axis Palate
// cares about. Only meaningful on Details responses (that's where Google
// returns the attributes); nearby/search responses simply have them undefined.
export interface AttributeSignals {
  occasion_tags: string[];
  crowd_energy: string[];
  tags: string[];
  vibe: string | null;
}

export function inferFromAttributes(p: GooglePlace, priceLevel: number | null): AttributeSignals {
  const occasion = new Set<string>();
  const crowd = new Set<string>();
  const tags = new Set<string>();
  let vibe: string | null = null;
  const price = priceLevel ?? 2;

  if (p.goodForGroups) occasion.add("group_dinner");
  if (p.goodForChildren || p.menuForChildren) {
    occasion.add("family_gathering");
    crowd.add("family_friendly");
    tags.add("family-friendly");
  }
  if (p.liveMusic) {
    occasion.add("party");
    tags.add("live-music");
    vibe = "lively";
  }
  if (p.servesCocktails) tags.add("cocktails");
  if (p.servesCocktails && p.liveMusic) vibe = "festive";
  // Reservable + upscale reads as a destination for planned, special meals.
  if (p.reservable && price >= 3) {
    occasion.add("celebration");
    occasion.add("business_dinner");
    if (!vibe) vibe = price >= 4 ? "upscale_formal" : "upscale_casual";
  }
  if (p.outdoorSeating) tags.add("outdoor-seating");
  if (p.goodForWatchingSports) { tags.add("sports"); occasion.add("group_dinner"); }
  if (p.servesBrunch) occasion.add("brunch");
  if (p.servesBreakfast) occasion.add("breakfast");
  if (p.allowsDogs) tags.add("dog-friendly");
  if (p.servesVegetarianFood) tags.add("vegetarian-friendly");
  // Takeout/delivery only (no dine-in) → a grab-and-go spot.
  if (p.dineIn === false && (p.takeout || p.delivery)) {
    occasion.add("quick_bite");
    tags.add("takeout");
  }

  return {
    occasion_tags: [...occasion],
    crowd_energy: [...crowd],
    tags: [...tags],
    vibe,
  };
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
  rating: number | null = null,
): string {
  return inferCulturalContextWithConfidence(chainType, priceLevel, ratingCount, rating)[0];
}

// Cultural context is the most editorial field — every assignment here is a
// heuristic. Cap confidence at ~0.7 so the LLM fallback can override later.
// Now uses rating AND count together so "hidden" means genuinely loved-but-
// small, and "trending" means mobbed, rather than raw count alone.
export function inferCulturalContextWithConfidence(
  chainType: string,
  priceLevel: number | null,
  ratingCount: number | null,
  rating: number | null = null,
): [string, number] {
  if (chainType === "national_chain") return ["comfort", 0.7];
  if (ratingCount != null && ratingCount > 6000) return ["trending", 0.55];
  if (rating != null && ratingCount != null
      && rating >= 4.4 && ratingCount >= 40 && ratingCount <= 1500) return ["hidden", 0.6];
  if (ratingCount != null && ratingCount < 50) return ["hidden", 0.5];
  if (priceLevel != null && priceLevel >= 4) return ["modernist", 0.55];
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
  ["date_night",      /\b(date night|romantic|anniversary|intimate|cozy|candle[- ]?lit|first date)\b/i],
  ["group_dinner",    /\b(family[- ]style|shareable|big group|large group|good for groups)\b/i],
  ["brunch",          /\b(brunch|mimosa|bottomless|weekend brunch|brunch spot)\b/i],
  ["late_night",      /\b(late night|after work drinks|2 ?am|midnight|bar food)\b/i],
  ["breakfast",       /\b(breakfast|early morning|first thing|pancakes|eggs and)\b/i],
  ["working_lunch",   /\b(working lunch|business lunch|quick lunch|in and out fast)\b/i],
  ["weekend_anchor",  /\b(weekend institution|saturday morning|sunday tradition|always packed weekends)\b/i],
  // New occasion axes — these are what let same-cuisine places diverge.
  ["celebration",     /\b(special occasion|celebrat\w*|graduation|birthday (dinner|party|celebration)|anniversary dinner|milestone|engagement|proposal|toast\w*)\b/i],
  ["business_dinner", /\b(business (dinner|lunch|meal)|client (dinner|lunch|meeting)|work (dinner|event)|power lunch|impress\w* clients?|expense account|corporate (dinner|event)|closing a deal|colleagues)\b/i],
  ["party",           /\b(part(y|ies)|loud|bumping|packed and loud|dj\b|bottle service|nightlife|club vibe|turn ?up|the scene|see and be seen|hype|lively crowd|dance floor)\b/i],
  ["family_gathering",/\b(family (gathering|dinner|reunion|meal)|kids? menu|high ?chairs?|whole family|great with kids|family friendly)\b/i],
  ["quick_bite",      /\b(quick bite|grab (and|&|'?n'?) go|counter service|takeout|to[- ]go|fast service|order at the counter)\b/i],
];

// Discovery signals mined from review / editorial text. These are the highest-
// value curation signals a discovery app can get for free: critic recognition
// (Michelin/Beard/etc.), "hidden gem" vs "tourist trap" language, and buzz.
// They land in the free-form `tags` array (and, for tourist language, nudge the
// crowd/cultural signals).
const REVIEW_SIGNAL_PATTERNS: Array<[string, RegExp]> = [
  // ---- Critic / award recognition (strong curation signal) ----
  ["michelin",              /\bmichelin\b/i],
  ["bib-gourmand",          /\bbib gourmand\b/i],
  ["james-beard",           /\bjames beard\b/i],
  ["celebrity-chef",        /\b(celebrity chef|star chef|renowned chef|acclaimed chef|iron chef|top chef|james beard (award|nominee|semifinalist))\b/i],
  ["critically-acclaimed",  /\b(critically acclaimed|award[- ]winning|award winner|the infatuation|zagat|eater\b|michelin (star|guide|recommended)|best (new )?restaurants?|top \d+|world'?s (\d+ )?best|forbes|\bnyt\b|new york times)\b/i],
  // ---- Hidden gem vs tourist trap ----
  ["hidden-gem",            /\b(hidden gem|underrated|off the beaten path|hole[- ]in[- ]the[- ]wall|best[- ]kept secret|neighborhood secret|don'?t tell anyone)\b/i],
  ["local-favorite",        /\b(local favorite|neighborhood (spot|favorite|joint|gem|staple)|locals love|where (the )?locals|beloved (local|neighborhood)|community staple)\b/i],
  ["tourist-heavy",         /\b(tourist trap|touristy|overrated|overhyped|overpriced|not worth the (hype|wait|price|money)|full of tourists|all hype)\b/i],
  // ---- Buzz / hard-to-get (trending signal) ----
  ["buzzy",                 /\b(impossible to get (a )?(reservation|table)|always a (wait|line)|hardest reservation|blew up|everyone'?s talking about|hottest (new )?(spot|restaurant|table)|booked (out |up )?(for )?(weeks|months)|month[- ]long wait|line out the door)\b/i],
];

export interface ReviewMiningResult {
  flavor_tags: string[];
  occasion_tags: string[];
  signal_tags: string[];
}

export function mineFromReviewSnippets(snippets: string[]): ReviewMiningResult {
  const corpus = snippets.join("\n").toLowerCase();
  if (!corpus) return { flavor_tags: [], occasion_tags: [], signal_tags: [] };

  const flavor: string[] = [];
  for (const [tag, pat] of REVIEW_FLAVOR_PATTERNS) {
    if (pat.test(corpus)) flavor.push(tag);
  }
  const occasion: string[] = [];
  for (const [tag, pat] of REVIEW_OCCASION_PATTERNS) {
    if (pat.test(corpus)) occasion.push(tag);
  }
  const signal: string[] = [];
  for (const [tag, pat] of REVIEW_SIGNAL_PATTERNS) {
    if (pat.test(corpus)) signal.push(tag);
  }
  return { flavor_tags: flavor, occasion_tags: occasion, signal_tags: signal };
}

// Hidden-gem vs tourist-trap scoring from the rating + review-count you already
// store. A place beloved but not yet mobbed is discovery gold; a 4.1 with 40k
// reviews is an overexposed destination. Pure, deterministic, no cost.
export function inferDiscoverySignals(
  rating: number | null,
  ratingCount: number | null,
): { tags: string[]; crowd: string[] } {
  const tags: string[] = [];
  const crowd: string[] = [];
  if (ratingCount != null && ratingCount < 40) {
    tags.push("new-or-undiscovered");
  }
  if (rating != null && ratingCount != null) {
    if (rating >= 4.4 && ratingCount >= 40 && ratingCount <= 1500) tags.push("hidden-gem");
    if (rating >= 4.3 && ratingCount > 1500 && ratingCount <= 8000) tags.push("local-favorite");
    if (ratingCount > 8000) { crowd.push("tourist_heavy"); tags.push("high-traffic"); }
  }
  return { tags, crowd };
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

// Google place types that mean "this isn't a discovery restaurant at all" —
// stores, institutional cafeterias, gas stations. Presence of any of these
// (without a real restaurant type also present) drops the place.
const NON_RESTAURANT_TYPES = new Set([
  "supermarket", "grocery_store", "convenience_store", "gas_station",
  "department_store", "shopping_mall", "warehouse_store", "liquor_store",
  "drugstore", "pharmacy", "cafeteria",
]);

// A "real restaurant" type present in types[] means the place serves as a
// dining destination even if it's inside a hotel/store — used to avoid
// over-excluding hotel restaurants and market stalls that are real spots.
const RESTAURANT_TYPES = new Set([
  "restaurant", "meal_takeaway", "meal_delivery", "cafe", "coffee_shop",
  "bakery", "bar", "wine_bar", "pub", "ice_cream_shop", "dessert_restaurant",
]);

function hasRestaurantType(types: string[]): boolean {
  return types.some((t) => RESTAURANT_TYPES.has(t) || t.endsWith("_restaurant"));
}

export function inferRecommendationEligibility(
  place: GooglePlace,
  derived: { chain_type: string; cuisine_type: string | null; format_class: string },
): EligibilityResult {
  const types = place.types ?? [];
  const name = (place.displayName?.text ?? "").toLowerCase();
  const address = (place.formattedAddress ?? place.shortFormattedAddress ?? "").toLowerCase();
  const haystack = `${name} ${address}`;

  // ---- HARD EXCLUDES (eligibility = 0) ----

  // Non-restaurant venues: grocery/convenience/gas/etc. with no real dining
  // type present. (A market stall Google also tags `restaurant` survives.)
  if (types.some((t) => NON_RESTAURANT_TYPES.has(t)) && !hasRestaurantType(types)) {
    return { eligibility: 0, reason: "not_a_restaurant" };
  }

  // Airports & captive transit venues. Require an actual airport signal — the
  // Google `airport` type or an "airport"/"airfield"/"international terminal"
  // keyword — rather than a bare "Terminal" token (which matches "Terminal
  // Market", ferry terminals, "Terminal Ave", etc.).
  if (types.includes("airport")) {
    return { eligibility: 0, reason: "airport" };
  }
  // "airport"/"airfield" keyword — but NOT when it's just a street name.
  // "Airport Blvd", "Airport Rd", "Airport Way" etc. are common city streets
  // lined with normal restaurants (e.g. Austin's Airport Blvd), nowhere near a
  // terminal. Skip the exclude when the token is immediately followed by a
  // street-type suffix.
  if (/\b(airport|airfield)\b(?!\s+(rd|road|blvd|boulevard|ave|avenue|st|street|way|hwy|highway|dr|drive|ln|lane|pkwy|parkway|cir|circle|ct|court|pl|place|ter|terrace|loop|row|pike|plaza|center|centre|ctr|sq|square))/.test(haystack)) {
    return { eligibility: 0, reason: "airport" };
  }
  if (/\bconcourse [a-z]\b/.test(address)) {
    return { eligibility: 0, reason: "airport" };
  }

  // Food courts and captive-venue concessions — quick-service you can't easily
  // seek out and wouldn't "discover." Explicit "food court" anywhere, or a
  // stadium/arena/convention address. NOTE: trendy "food halls" (Chelsea
  // Market, Time Out Market) are destinations and are deliberately NOT excluded.
  if (/\bfood court\b/.test(haystack)) {
    return { eligibility: 0, reason: "food_court" };
  }
  if (/\b(stadium|arena|ballpark|amphitheater|amphitheatre|convention center|convention centre|fairgrounds|casino floor)\b/.test(address)) {
    return { eligibility: 0, reason: "captive_venue" };
  }

  // Hotels — exclude only when the place IS the hotel (lodging is the dominant
  // signal and no real restaurant type is present). A named hotel restaurant
  // that Google also tags `restaurant` stays eligible — those are destinations.
  if (place.primaryType === "lodging" && !hasRestaurantType(types)) {
    return { eligibility: 0, reason: "hotel" };
  }
  if (types.includes("lodging") && !hasRestaurantType(types)) {
    return { eligibility: 0, reason: "hotel_generic" };
  }

  // Nightlife lounges — hookah/cigar/bottle-service/members lounges are not the
  // food destinations Palate surfaces. But a bare "Lounge" in the name is NOT
  // enough (many real restaurants use it): require a nightlife/gated signal or
  // a night_club type with no restaurant type present.
  if (/\blounge\b/.test(name)) {
    const gated = /\b(members|member's|private|airport|terminal|club|priority pass|admirals|centurion|sky ?club)\b/.test(haystack);
    const nightlife = /\b(hookah|shisha|cigar|bottle service|vip|nightclub|night club|gentlemen'?s)\b/.test(haystack);
    if (gated) return { eligibility: 0, reason: "lounge_gated" };
    if (nightlife) return { eligibility: 0, reason: "lounge_nightlife" };
    // otherwise fall through — treat as a normal restaurant named "...Lounge"
  }
  if ((types.includes("night_club") || /\b(hookah|shisha) (lounge|bar|spot)\b/.test(haystack)) && !hasRestaurantType(types)) {
    return { eligibility: 0, reason: "nightlife" };
  }

  // Fast food — Google's explicit fast_food_restaurant type (the
  // McDonald's / Burger King tier). Independent cheap eats are NOT caught
  // here (they keep eligibility), so the feed loses true fast food without
  // nuking great low-price local spots.
  if (types.includes("fast_food_restaurant")) {
    return { eligibility: 0, reason: "fast_food" };
  }

  // National / well-known chains — across all formats and price tiers. A
  // discovery feed shouldn't push brands users already know (McDonald's,
  // Chipotle, Olive Garden, Starbucks, Cheesecake Factory…). Search still finds
  // them by name.
  if (derived.chain_type === "national_chain") {
    return { eligibility: 0, reason: "national_chain" };
  }

  // ---- SOFT DOWNRANK (kept for any future regional/local chain tagging) ----

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

  let [cuisine, cuisineConf] = inferCuisineFromTypesWithConfidence(types);
  const { subregion, region, confidence: subregionConf } = inferSubregionWithConfidence(name, types);
  // Fallback: if Google types gave no cuisine but a name-based subregion rule
  // fired (e.g. "Sichuan Impression" typed only `restaurant`), derive the broad
  // cuisine from the subregion so the two never disagree. Confidence tracks the
  // subregion signal but is capped since it's an inference, not a Google label.
  if (cuisine === null && subregion) {
    const fromSub = SUBREGION_TO_CUISINE[subregion];
    if (fromSub) {
      cuisine = fromSub;
      cuisineConf = Math.min(subregionConf, 0.7);
    }
  }
  const [formatClass, formatConf] = inferFormatClassWithConfidence(types, price);
  const chainName = detectChain(name);
  const [chainType, chainConf] = inferChainTypeWithConfidence(name, chainName);
  const [culturalContext, culturalConf] = inferCulturalContextWithConfidence(
    chainType,
    price,
    p.userRatingCount ?? null,
    p.rating ?? null,
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
  // Google's structured atmosphere attributes — deterministic occasion/crowd/
  // vibe/tag signal (Details responses only; undefined elsewhere).
  const attrs = inferFromAttributes(p, price);
  const occasionTags = Array.from(new Set([...baseOccasion, ...mined.occasion_tags, ...attrs.occasion_tags]));
  const flavorTags = Array.from(new Set([...baseFlavor, ...mined.flavor_tags]));

  // Discovery signals: critic/award + hidden-gem/tourist language mined from
  // reviews, plus a hidden-gem vs high-traffic read from rating × review count.
  const discovery = inferDiscoverySignals(p.rating ?? null, p.userRatingCount ?? null);
  const crowdEnergy = Array.from(new Set([
    ...attrs.crowd_energy,
    ...discovery.crowd,
    ...(mined.signal_tags.includes("tourist-heavy") ? ["tourist_heavy"] : []),
  ]));
  const signalTags = Array.from(new Set([...mined.signal_tags, ...discovery.tags]));

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
    // Qualitative tags: seed vibe/crowd from Google's deterministic atmosphere
    // attributes when present; the LLM merge can still override with a
    // review-grounded read. menu_style / price_feel / ambiance stay LLM-only.
    vibe: attrs.vibe,
    crowd_energy: crowdEnergy,
    menu_style: null,
    price_feel: null,
    ambiance_notes: null,
    tags: Array.from(new Set([...deriveTags(cuisine, primaryType, price), ...attrs.tags, ...signalTags])),
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
    // Qualitative "feel" tags (LLM-derived; null when not enriched).
    vibe: d.vibe,
    crowd_energy: d.crowd_energy.length ? d.crowd_energy : null,
    menu_style: d.menu_style,
    price_feel: d.price_feel,
    ambiance_notes: d.ambiance_notes,
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
