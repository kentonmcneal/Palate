// ============================================================================
// RestaurantProfile — the *behavioral meaning* layer over a raw restaurant row.
// ----------------------------------------------------------------------------
// Google gives us cuisine, price, address. WE give the meaning:
//   - decisionIntent (no_friction vs preference_driven vs intentional vs ...)
//   - flavorSignature (a short human-readable string)
//   - format (quick_service vs fast_casual vs casual_dining vs ...)
//   - brandTier (value vs mainstream vs premium_fast_casual vs ...)
//
// Critical invariant: NOT ALL FAST FOOD IS THE SAME.
//   McDonald's = no_friction, engineered consistency
//   Burger King = preference_driven, smoky craving
//   Sweetgreen  = intentional, fresh
//   Panda Express = no_friction, saucy American Chinese
// ============================================================================

import type { Restaurant } from "./places";

export type RestaurantFormat =
  | "quick_service"
  | "fast_casual"
  | "casual_dining"
  | "fine_dining"
  | "cafe"
  | "bar";

export type BrandTier =
  | "value"
  | "mainstream"
  | "premium_fast_casual"
  | "upscale"
  | "luxury";

export type DecisionIntent =
  | "no_friction"
  | "preference_driven"
  | "intentional"
  | "exploratory"
  | "social";

export type TasteTag =
  | "salty" | "sweet" | "savory" | "spicy" | "smoky"
  | "fried" | "grilled" | "fresh" | "hearty" | "light"
  | "saucy" | "cheesy" | "crunchy";

export type BehaviorTag =
  | "convenient" | "routine" | "indulgent" | "healthy_leaning"
  | "comfort_food" | "exploratory" | "social" | "elevated" | "budget_friendly";

export type Signal = "low" | "medium" | "high";

export type RestaurantProfile = {
  id?: string;
  name: string;
  cuisineTypes: string[];
  format: RestaurantFormat;
  brandTier: BrandTier;
  priceLevel: 1 | 2 | 3 | 4;
  tasteTags: TasteTag[];
  behaviorTags: BehaviorTag[];
  healthSignal: Signal;
  noveltySignal: Signal;
  comfortSignal: Signal;
  decisionIntent: DecisionIntent;
  flavorSignature: string;
};

// ============================================================================
// BRAND_PROFILE — per-chain overrides. The heart of the "not all fast food
// is the same" principle. When a chain is identified we use these values
// directly; otherwise we fall back to format/price/cuisine-based inference.
// ============================================================================

type BrandOverride = Partial<
  Pick<RestaurantProfile,
    | "decisionIntent" | "flavorSignature" | "tasteTags" | "behaviorTags"
    | "healthSignal" | "comfortSignal" | "noveltySignal" | "format" | "brandTier">
>;

const BRAND_PROFILE: Record<string, BrandOverride> = {
  // ---- Value / quick service ----
  "McDonald's": {
    decisionIntent: "no_friction",
    flavorSignature: "salty, highly consistent, engineered fast food",
    tasteTags: ["salty", "fried", "savory"],
    behaviorTags: ["convenient", "routine", "budget_friendly"],
    healthSignal: "low", comfortSignal: "high", noveltySignal: "low",
    format: "quick_service", brandTier: "value",
  },
  "Burger King": {
    decisionIntent: "preference_driven",
    flavorSignature: "smoky, flame-grilled, heavier fast food",
    tasteTags: ["smoky", "grilled", "savory", "salty"],
    behaviorTags: ["indulgent", "comfort_food"],
    healthSignal: "low", comfortSignal: "high", noveltySignal: "low",
    format: "quick_service", brandTier: "value",
  },
  "Wendy's": {
    decisionIntent: "preference_driven",
    flavorSignature: "salty fries and cult-favorite chili",
    tasteTags: ["salty", "savory", "fried"],
    behaviorTags: ["comfort_food", "budget_friendly"],
    healthSignal: "low", comfortSignal: "high", noveltySignal: "low",
    format: "quick_service", brandTier: "value",
  },
  "Taco Bell": {
    decisionIntent: "no_friction",
    flavorSignature: "indulgent, late-night, value-engineered Tex-Mex",
    tasteTags: ["spicy", "cheesy", "savory"],
    behaviorTags: ["indulgent", "convenient", "budget_friendly"],
    healthSignal: "low", comfortSignal: "high",
    format: "quick_service", brandTier: "value",
  },
  "Subway": {
    decisionIntent: "no_friction",
    flavorSignature: "neutral, on-the-go sandwich routine",
    tasteTags: ["fresh", "savory"],
    behaviorTags: ["convenient", "routine", "budget_friendly"],
    healthSignal: "medium",
    format: "quick_service", brandTier: "value",
  },
  "Popeyes": {
    decisionIntent: "preference_driven",
    flavorSignature: "spicy, crackly fried chicken",
    tasteTags: ["spicy", "fried", "crunchy", "salty"],
    behaviorTags: ["indulgent", "comfort_food"],
    healthSignal: "low", comfortSignal: "high",
    format: "quick_service", brandTier: "value",
  },
  "In-N-Out": {
    decisionIntent: "preference_driven",
    flavorSignature: "minimal-menu cult burger, smashed-and-griddled",
    tasteTags: ["salty", "savory", "grilled"],
    behaviorTags: ["indulgent", "comfort_food", "routine"],
    healthSignal: "low", comfortSignal: "high",
    format: "quick_service", brandTier: "value",
  },

  // ---- Mainstream / fast casual ----
  "Chick-fil-A": {
    decisionIntent: "preference_driven",
    flavorSignature: "crispy, savory, cult-favorite chicken sandwich",
    tasteTags: ["fried", "savory", "salty"],
    behaviorTags: ["comfort_food", "routine"],
    healthSignal: "low", comfortSignal: "high",
    format: "quick_service", brandTier: "mainstream",
  },
  "Chipotle": {
    decisionIntent: "intentional",
    flavorSignature: "build-your-own, spiced, customizable burrito format",
    tasteTags: ["savory", "spicy", "hearty"],
    behaviorTags: ["healthy_leaning", "convenient", "elevated"],
    healthSignal: "medium",
    format: "fast_casual", brandTier: "mainstream",
  },
  "Panera": {
    decisionIntent: "no_friction",
    flavorSignature: "comforting soup-and-sandwich predictability",
    tasteTags: ["savory", "hearty"],
    behaviorTags: ["routine", "comfort_food"],
    healthSignal: "medium",
    format: "fast_casual", brandTier: "mainstream",
  },
  "Panda Express": {
    decisionIntent: "no_friction",
    flavorSignature: "saucy, bold, American Chinese takeout",
    tasteTags: ["saucy", "savory", "salty"],
    behaviorTags: ["convenient", "indulgent"],
    healthSignal: "low",
    format: "quick_service", brandTier: "mainstream",
  },
  "Five Guys": {
    decisionIntent: "preference_driven",
    flavorSignature: "loud, indulgent, no-frills classic burger",
    tasteTags: ["salty", "savory"],
    behaviorTags: ["indulgent", "comfort_food"],
    healthSignal: "low",
    format: "fast_casual", brandTier: "mainstream",
  },
  "Starbucks": {
    decisionIntent: "no_friction",
    flavorSignature: "consistent espresso, predictable comfort drinks",
    tasteTags: ["sweet"],
    behaviorTags: ["routine", "convenient"],
    format: "cafe", brandTier: "mainstream",
  },
  "Dunkin": {
    decisionIntent: "no_friction",
    flavorSignature: "sweet, easy, morning fuel",
    tasteTags: ["sweet"],
    behaviorTags: ["convenient", "routine", "budget_friendly"],
    healthSignal: "low",
    format: "cafe", brandTier: "value",
  },

  // ---- Premium fast casual ----
  "Sweetgreen": {
    decisionIntent: "intentional",
    flavorSignature: "fresh, seasonal, healthy-leaning bowls",
    tasteTags: ["fresh", "light", "savory"],
    behaviorTags: ["healthy_leaning", "elevated", "routine"],
    healthSignal: "high", comfortSignal: "low",
    format: "fast_casual", brandTier: "premium_fast_casual",
  },
  "Cava": {
    decisionIntent: "intentional",
    flavorSignature: "bright Mediterranean, fresh and assertive",
    tasteTags: ["fresh", "savory", "spicy"],
    behaviorTags: ["healthy_leaning", "elevated"],
    healthSignal: "high",
    format: "fast_casual", brandTier: "premium_fast_casual",
  },
  "Joe & The Juice": {
    decisionIntent: "intentional",
    flavorSignature: "fresh juice and pressed sandwiches",
    tasteTags: ["fresh", "sweet"],
    behaviorTags: ["healthy_leaning", "elevated"],
    healthSignal: "high",
    format: "cafe", brandTier: "premium_fast_casual",
  },
  "Shake Shack": {
    decisionIntent: "preference_driven",
    flavorSignature: "elevated burger comfort, crinkle-cut indulgence",
    tasteTags: ["salty", "savory", "cheesy"],
    behaviorTags: ["indulgent", "elevated", "comfort_food"],
    healthSignal: "low", comfortSignal: "high",
    format: "fast_casual", brandTier: "premium_fast_casual",
  },
  "Pret": {
    decisionIntent: "no_friction",
    flavorSignature: "bright, fresh-grab sandwich and salad convenience",
    tasteTags: ["fresh", "light"],
    behaviorTags: ["convenient", "healthy_leaning"],
    healthSignal: "medium",
    format: "cafe", brandTier: "premium_fast_casual",
  },
};

/** Match a Restaurant to its brand override, by chain_name first then name keyword. */
function findBrandKey(r: Pick<Restaurant, "chain_name" | "name">): string | null {
  if (r.chain_name && BRAND_PROFILE[r.chain_name]) return r.chain_name;
  const name = (r.name ?? "").toLowerCase();
  for (const brand of Object.keys(BRAND_PROFILE)) {
    if (name.includes(brand.toLowerCase())) return brand;
  }
  return null;
}

// ============================================================================
// Inference fallbacks — used when a restaurant isn't a known chain.
// ============================================================================

function inferFormat(primary: string | null | undefined, price: number): RestaurantFormat {
  if (primary === "cafe") return "cafe";
  if (primary === "bar") return "bar";
  if (primary === "meal_takeaway" || primary === "meal_delivery") {
    return price <= 1 ? "quick_service" : "fast_casual";
  }
  if (price >= 4) return "fine_dining";
  return "casual_dining";
}

function inferBrandTier(format: RestaurantFormat, price: number): BrandTier {
  if (format === "fine_dining") return price >= 4 ? "luxury" : "upscale";
  if (price >= 3) return "upscale";
  if (format === "fast_casual" || format === "cafe") return price >= 2 ? "premium_fast_casual" : "mainstream";
  if (format === "quick_service") return "value";
  return "mainstream";
}

function inferDecisionIntent(format: RestaurantFormat, brandTier: BrandTier, price: number): DecisionIntent {
  if (brandTier === "premium_fast_casual" || brandTier === "upscale" || brandTier === "luxury") return "intentional";
  if (format === "quick_service" && brandTier === "value") return "no_friction";
  if (format === "bar") return "social";
  return "preference_driven";
}

function inferTasteTags(cuisine: string | null | undefined): TasteTag[] {
  const tags = new Set<TasteTag>();
  switch (cuisine) {
    case "mexican":  tags.add("spicy"); tags.add("savory"); break;
    case "thai":     tags.add("spicy"); tags.add("savory"); break;
    case "indian":   tags.add("spicy"); tags.add("hearty"); break;
    case "italian":  tags.add("hearty"); tags.add("cheesy"); break;
    case "japanese": tags.add("savory"); tags.add("light"); break;
    case "korean":   tags.add("spicy"); tags.add("grilled"); break;
    case "chinese":  tags.add("saucy"); tags.add("savory"); break;
    case "american": tags.add("savory"); tags.add("salty"); break;
    case "bbq":      tags.add("smoky"); tags.add("hearty"); break;
    case "bakery":   tags.add("sweet"); break;
    case "dessert":  tags.add("sweet"); break;
    case "café":     tags.add("sweet"); break;
    case "healthy":  tags.add("fresh"); tags.add("light"); break;
    case "seafood":  tags.add("fresh"); tags.add("light"); break;
  }
  return [...tags];
}

function inferBehaviorTags(format: RestaurantFormat, brandTier: BrandTier, intent: DecisionIntent): BehaviorTag[] {
  const tags = new Set<BehaviorTag>();
  if (intent === "no_friction")        tags.add("convenient");
  if (intent === "intentional")        tags.add("elevated");
  if (intent === "social")             tags.add("social");
  if (format === "quick_service")      { tags.add("convenient"); tags.add("budget_friendly"); }
  if (brandTier === "premium_fast_casual" || brandTier === "upscale") tags.add("elevated");
  if (brandTier === "value")           tags.add("budget_friendly");
  return [...tags];
}

function inferHealthSignal(brandTier: BrandTier, cuisine: string | null | undefined): Signal {
  if (cuisine === "healthy") return "high";
  if (cuisine === "seafood" || cuisine === "japanese" || cuisine === "mediterranean") return "high";
  if (brandTier === "premium_fast_casual" && (cuisine !== "italian" && cuisine !== "american")) return "high";
  if (brandTier === "value") return "low";
  return "medium";
}

function inferComfortSignal(cuisine: string | null | undefined, format: RestaurantFormat): Signal {
  if (cuisine === "italian" || cuisine === "american" || cuisine === "bbq" || cuisine === "comfort") return "high";
  if (format === "fine_dining") return "low";
  return "medium";
}

function inferFlavorSignature(cuisine: string | null | undefined, format: RestaurantFormat, price: number): string {
  const cuisineLabel = cuisine ?? "varied";
  if (format === "fine_dining") return `${cuisineLabel} tasting, technique-forward and considered`;
  if (format === "cafe") return `${cuisineLabel} café staples, calm-energy fuel`;
  if (format === "bar") return `${cuisineLabel} bar bites, designed to share`;
  if (format === "fast_casual") return `${cuisineLabel} done quickly without cutting corners`;
  if (format === "quick_service") return `${cuisineLabel} engineered for speed`;
  return `${cuisineLabel} in a sit-down format`;
}

// ============================================================================
// Public: derive a RestaurantProfile from a raw Restaurant row.
// ============================================================================

export function deriveRestaurantProfile(r: Restaurant): RestaurantProfile {
  const brandKey = findBrandKey(r);
  const brand = brandKey ? BRAND_PROFILE[brandKey] : {};
  const cuisine = r.cuisine_type ?? null;
  const cuisines = cuisine ? [cuisine] : [];
  const price = (r.price_level ?? 2) as 1 | 2 | 3 | 4;

  const format = brand.format ?? inferFormat(r.primary_type, price);
  const brandTier = brand.brandTier ?? inferBrandTier(format, price);
  const decisionIntent = brand.decisionIntent ?? inferDecisionIntent(format, brandTier, price);
  const flavorSignature = brand.flavorSignature ?? inferFlavorSignature(cuisine, format, price);
  const tasteTags = brand.tasteTags ?? inferTasteTags(cuisine);
  const behaviorTags = brand.behaviorTags ?? inferBehaviorTags(format, brandTier, decisionIntent);
  const healthSignal = brand.healthSignal ?? inferHealthSignal(brandTier, cuisine);
  const comfortSignal = brand.comfortSignal ?? inferComfortSignal(cuisine, format);
  const noveltySignal = brand.noveltySignal ?? (brandKey ? "low" : "medium");

  return {
    id: r.id,
    name: r.name,
    cuisineTypes: cuisines,
    format,
    brandTier,
    priceLevel: price,
    tasteTags,
    behaviorTags,
    healthSignal,
    noveltySignal,
    comfortSignal,
    decisionIntent,
    flavorSignature,
  };
}

/** Whether two restaurants share enough flavor DNA to be "similar". */
export function flavorSimilarity(a: RestaurantProfile, b: RestaurantProfile): number {
  let score = 0;
  if (a.cuisineTypes[0] && a.cuisineTypes[0] === b.cuisineTypes[0]) score += 3;
  if (a.format === b.format) score += 1;
  if (a.brandTier === b.brandTier) score += 1;
  if (a.decisionIntent === b.decisionIntent) score += 1;
  const sharedTaste = a.tasteTags.filter((t) => b.tasteTags.includes(t)).length;
  score += sharedTaste * 0.5;
  return score;
}
