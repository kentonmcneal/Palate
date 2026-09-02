// ============================================================================
// recommendation/chains.ts — a name-based floor for national-chain detection.
// ----------------------------------------------------------------------------
// This is a FLOOR, not the whole system. The general mechanisms stay:
//   • restaurants.chain_name          — set by the classifier
//   • Google primary_type / types[]   — fast_food_restaurant, meal_takeaway…
//   • restaurants.is_chain_brand      — DB heuristic (same brand at >=3 places,
//                                       migration 0052)
//
// It exists because all three of those can be absent on a freshly-seen,
// unclassified venue — which is exactly how Domino's Pizza reached the
// "Stretch your palate" slot at 31% match on a tester's Home tab.
//
// Matching is deliberately conservative. A chain matches when the normalized
// name IS the brand, or is the brand followed only by generic descriptors
// ("Domino's Pizza", "Sonic Drive-In #4521"). "Sonic Boom Ramen" does NOT
// match "Sonic", because "boom ramen" is not a generic descriptor. We would
// rather miss a chain (the other three nets can still catch it) than suppress
// an independent restaurant, which is unrecoverable from the user's side.
// ============================================================================

/**
 * National / large-regional brands that add no discovery value. Everyone
 * already knows these; surfacing them as a "recommendation" is noise.
 * Stored pre-normalized (lowercase, no punctuation) — see normalizeBrand().
 */
const NATIONAL_CHAINS: string[] = [
  // Pizza
  "dominos", "pizza hut", "papa johns", "little caesars", "marcos pizza",
  "cicis", "round table pizza", "blaze pizza", "mod pizza", "papa murphys",
  // Burgers / fast food
  "mcdonalds", "burger king", "wendys", "five guys", "shake shack",
  "sonic drive in", "sonic", "jack in the box", "whataburger", "culvers",
  "hardees", "carls jr", "checkers", "rallys", "steak n shake", "white castle",
  "in n out burger", "smashburger", "fuddruckers", "red robin",
  // Chicken
  "kfc", "kentucky fried chicken", "popeyes", "chick fil a", "raising canes",
  "zaxbys", "bojangles", "wingstop", "buffalo wild wings", "churchs chicken", "el pollo loco", "wings over",
  // Mexican / Tex-Mex
  "taco bell", "chipotle", "chipotle mexican grill", "qdoba", "moes southwest grill",
  "del taco", "baja fresh",
  // Sandwiches / subs
  "subway", "jersey mikes", "jimmy johns", "firehouse subs", "quiznos",
  "potbelly", "which wich", "charleys philly steaks", "arbys",
  // Asian fast casual
  "panda express", "pei wei", "sarku japan",
  // Bakery / cafe / coffee
  "starbucks", "dunkin", "dunkin donuts", "panera", "panera bread",
  "krispy kreme", "einstein bros bagels", "cinnabon", "auntie annes",
  "tim hortons", "peets coffee", "caribou coffee",
  // Casual dining
  "applebees", "chilis", "olive garden", "tgi fridays", "red lobster",
  "outback steakhouse", "ihop", "dennys", "cracker barrel", "waffle house",
  "golden corral", "texas roadhouse", "longhorn steakhouse", "ruby tuesday",
  "hooters", "the cheesecake factory", "cheesecake factory", "pf changs",
  "bonefish grill", "carrabbas italian grill", "maggianos little italy",
  "cheddars scratch kitchen", "cheddars", "logans roadhouse", "bertuccis",
  "bjs restaurant", "yard house", "dave busters",
  "teds montana grill", "first watch", "another broken egg cafe",
  "bubba gump shrimp", "joes crab shack", "long john silvers", "captain ds",
  "boston market", "cafe rio", "noodles company", "fazolis", "sbarro",
];

/**
 * Tokens that may legitimately trail a brand name on a store's Google listing
 * without changing which brand it is. Used to allow "Domino's Pizza" and
 * "Sonic Drive-In" while rejecting "Sonic Boom Ramen".
 */
const GENERIC_SUFFIXES = new Set([
  "pizza", "grill", "grille", "bar", "restaurant", "restaurants", "cafe",
  "coffee", "kitchen", "express", "drive", "in", "thru", "through",
  "sandwiches", "sandwich", "subs", "burgers", "burger", "chicken", "wings",
  "steakhouse", "steaks", "bakery", "donuts", "doughnuts", "ice", "cream",
  "mexican", "italian", "american", "chinese", "japanese", "seafood", "bbq",
  "barbecue", "deli", "market", "shop", "store", "house", "tavern", "pub",
  "eatery", "diner", "roadhouse", "brewhouse", "sports", "and", "the", "of",
  "co", "company", "inc", "llc", "to", "go", "takeout", "delivery", "food",
  "n", "s",
]);

/**
 * Lowercase, strip diacritics and punctuation, drop store-location noise
 * (parentheticals, "#4521", anything after a dash/pipe separator), collapse
 * whitespace. "Domino's Pizza - Newport News (Store #4521)" -> "dominos pizza".
 */
export function normalizeBrand(raw: string): string {
  let s = (raw ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Drop parentheticals and bracketed location tags.
  s = s.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  // Cut at a separator that typically precedes a location: " - ", " | ", " @ ".
  s = s.split(/\s[-–—|@]\s/)[0];
  // Drop store numbers.
  s = s.replace(/#\s*\d+/g, " ");
  // Punctuation -> space (apostrophes close up: "domino's" -> "dominos").
  s = s.replace(/['’`]/g, "");
  s = s.replace(/[^a-z0-9]+/g, " ");
  // Trailing bare store number ("mcdonalds 4521").
  s = s.replace(/\s\d{2,}\s*$/g, " ");
  return s.trim().replace(/\s+/g, " ");
}

/**
 * True when the name is a known national chain, allowing only generic
 * descriptors after the brand. Conservative by design — see the file header.
 */
export function isNationalChainName(name: string | null | undefined): boolean {
  if (!name) return false;
  const norm = normalizeBrand(name);
  if (!norm) return false;

  for (const brand of NATIONAL_CHAINS) {
    if (norm === brand) return true;
    if (!norm.startsWith(brand + " ")) continue;
    const rest = norm.slice(brand.length + 1).split(" ").filter(Boolean);
    if (rest.every((t) => GENERIC_SUFFIXES.has(t) || /^\d+$/.test(t))) return true;
  }
  return false;
}

/** Exported for tests and for the migration's parity check. */
export const NATIONAL_CHAIN_COUNT = NATIONAL_CHAINS.length;
