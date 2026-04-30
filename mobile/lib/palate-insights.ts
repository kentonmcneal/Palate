import { supabase } from "./supabase";
import { nearbyRestaurants, type Restaurant } from "./places";

// ============================================================================
// Types
// ============================================================================

export type PalateTrait =
  | "spicy"
  | "casual"
  | "upscale"
  | "comfort"
  | "late-night"
  | "quick-service"
  | "brunch"
  | "seafood"
  | "healthy"
  | "sweet"
  | "shareable"
  | "date-night"
  | "group-friendly"
  | "café";

export type PalateInsight = {
  weekStart: string;
  weekEnd: string;
  visitCount: number;
  uniqueRestaurantCount: number;
  primaryCuisine: string | null;
  cuisineCounts: Record<string, number>;
  dominantTrait: PalateTrait | null;
  experimentalTrait: PalateTrait | null;
  topRestaurantName: string | null;
  anchorPlaceId: string | null;
  anchorLatLng: { lat: number; lng: number } | null;
  /** Pre-rendered playful headline sentence. */
  copy: string;
  isLowData: boolean;
};

export type RestaurantRecommendation = {
  google_place_id: string;
  name: string;
  cuisine: string | null;
  neighborhood: string | null;
  /** Why we picked it — shown on the card. */
  reason: string;
  price_level?: number | null;
  rating?: number | null;
};

export type PalateRecommendations = {
  similar: RestaurantRecommendation[];
  stretch: RestaurantRecommendation | null;
};

// ============================================================================
// Cuisine + trait inference (fallback path)
// ----------------------------------------------------------------------------
// places-proxy now populates cuisine_type, neighborhood, and tags from
// Google's types[] + addressComponents. Restaurants written before that
// change will still have nulls, so we fall back to keyword matching on
// name + chain. The keyword table also catches edge cases Google misses
// (e.g. "Joe & The Juice" → healthy; "Levain" → bakery).
// ============================================================================

const CUISINE_KEYWORDS: Array<[RegExp, string]> = [
  [/sweetgreen|saladworks|just\s*salad/i, "healthy"],
  [/chipotle|qdoba|taqueria|tacos?\b|burrito|cantina|mexican/i, "mexican"],
  [/sushi|izakaya|ramen|udon|donburi|japanese/i, "japanese"],
  [/pho\b|banh\s*mi|vietnamese/i, "vietnamese"],
  [/thai|pad\s*thai|tom\s*yum/i, "thai"],
  [/curry|tandoor|indian|naan|dosa|biryani/i, "indian"],
  [/pizza|pizzeria|pasta|trattoria|osteria|italian/i, "italian"],
  [/burger|diner|smashburger|five\s*guys|in-?n-?out/i, "american"],
  [/bbq|barbecue|smokehouse|brisket/i, "bbq"],
  [/cava|mediterranean|gyro|falafel|hummus/i, "mediterranean"],
  [/shawarma|kebab|middle\s*eastern|halal/i, "middle-eastern"],
  [/dim\s*sum|chinese|szechuan|cantonese|peking|noodle/i, "chinese"],
  [/korean|kbbq|bibimbap|bulgogi/i, "korean"],
  [/poke/i, "healthy"],
  [/juice|smoothie|joe\s*&\s*the\s*juice/i, "healthy"],
  [/bakery|patisserie|croissant|levain|maman/i, "bakery"],
  [/coffee|café|cafe|espresso|blue\s*bottle|starbucks|dunkin|pret/i, "café"],
  [/ice\s*cream|gelato|froyo|dessert/i, "dessert"],
  [/seafood|oyster|lobster|crab|clam/i, "seafood"],
  [/steakhouse|chophouse|prime/i, "steakhouse"],
  [/wine\s*bar|cocktail|tavern|pub|brewery/i, "bar"],
];

function inferCuisine(r: Pick<Restaurant, "name" | "chain_name" | "primary_type" | "cuisine_type">): string | null {
  // Prefer the value populated by places-proxy (from Google's types[]).
  if (r.cuisine_type) return r.cuisine_type;

  const text = `${r.name ?? ""} ${r.chain_name ?? ""}`;
  for (const [pattern, cuisine] of CUISINE_KEYWORDS) {
    if (pattern.test(text)) return cuisine;
  }
  // Fall back to primary_type for the obvious cases.
  switch (r.primary_type) {
    case "bakery": return "bakery";
    case "cafe":   return "café";
    case "bar":    return "bar";
    default:       return null;
  }
}

function inferTraits(
  r: Pick<Restaurant, "name" | "chain_name" | "primary_type" | "price_level" | "tags">,
  cuisine: string | null,
): PalateTrait[] {
  // Prefer tags populated server-side by places-proxy.
  if (r.tags && r.tags.length) {
    // Filter to known PalateTrait values (defensive against future server tags).
    const known = new Set<string>([
      "spicy", "casual", "upscale", "comfort", "late-night", "quick-service",
      "brunch", "seafood", "healthy", "sweet", "shareable", "date-night",
      "group-friendly", "café",
    ]);
    return r.tags.filter((t) => known.has(t)) as PalateTrait[];
  }
  const traits = new Set<PalateTrait>();
  const price = r.price_level ?? 2;

  if (cuisine === "mexican" || cuisine === "thai" || cuisine === "indian" || cuisine === "korean") traits.add("spicy");
  if (cuisine === "japanese" || cuisine === "seafood") traits.add("seafood");
  if (cuisine === "healthy") traits.add("healthy");
  if (cuisine === "bakery" || cuisine === "dessert") { traits.add("sweet"); traits.add("brunch"); }
  if (cuisine === "café") { traits.add("café"); traits.add("brunch"); }
  if (cuisine === "italian" || cuisine === "american" || cuisine === "bbq") traits.add("comfort");
  if (cuisine === "steakhouse") { traits.add("upscale"); traits.add("date-night"); }
  if (cuisine === "chinese" || cuisine === "korean" || cuisine === "indian") traits.add("shareable");

  switch (r.primary_type) {
    case "bar":           traits.add("late-night"); traits.add("group-friendly"); break;
    case "meal_takeaway": case "meal_delivery": traits.add("quick-service"); break;
    case "cafe":          traits.add("café"); break;
  }

  if (price >= 3) { traits.add("upscale"); traits.add("date-night"); }
  if (price <= 1) traits.add("casual");

  return [...traits];
}

/** Pull the neighborhood-ish bit out of "1234 Main St, Brooklyn, NY 11201". */
function neighborhoodFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    // Drop the trailing "City State Zip" segment, return the one before.
    return parts[parts.length - 2] ?? null;
  }
  return null;
}

// ============================================================================
// Headline copy generator
// ============================================================================

const CUISINE_DISPLAY: Record<string, string> = {
  "café": "café",
  "japanese": "Japanese",
  "mexican": "Mexican",
  "italian": "Italian",
  "thai": "Thai",
  "vietnamese": "Vietnamese",
  "indian": "Indian",
  "chinese": "Chinese",
  "korean": "Korean",
  "american": "American comfort",
  "bbq": "BBQ",
  "mediterranean": "Mediterranean",
  "middle-eastern": "Middle Eastern",
  "bakery": "bakery",
  "dessert": "dessert",
  "healthy": "fast-casual healthy",
  "seafood": "seafood",
  "steakhouse": "steakhouse",
  "bar": "bar-and-bite",
};

const TRAIT_DISPLAY: Record<PalateTrait, string> = {
  spicy: "spicy",
  casual: "casual",
  upscale: "upscale",
  comfort: "comfort food",
  "late-night": "late-night",
  "quick-service": "quick-service",
  brunch: "brunch",
  seafood: "seafood",
  healthy: "healthy",
  sweet: "sweet",
  shareable: "shareable plates",
  "date-night": "date-night",
  "group-friendly": "group-friendly",
  "café": "café",
};

function buildHeadline(i: PalateInsight): string {
  if (i.isLowData) {
    return "Your Palate is still warming up. Visit a few more spots this week to unlock sharper recommendations.";
  }
  const cuisine = i.primaryCuisine ? CUISINE_DISPLAY[i.primaryCuisine] ?? i.primaryCuisine : "everything";
  const dom = i.dominantTrait ? TRAIT_DISPLAY[i.dominantTrait] : null;
  const exp = i.experimentalTrait ? TRAIT_DISPLAY[i.experimentalTrait] : null;

  const parts: string[] = [];
  parts.push(`Based on your Palate this week, you're into ${cuisine} food.`);
  if (dom && exp && dom !== exp) {
    parts.push(`Your Palate loves ${dom} spots and likes to experiment with ${exp}.`);
  } else if (dom) {
    parts.push(`Your Palate loves ${dom} spots.`);
  } else if (exp) {
    parts.push(`Your Palate is curious about ${exp}.`);
  }
  return parts.join(" ");
}

// ============================================================================
// Public: analyzeWeeklyPalate
// ============================================================================

type WeeklyVisitRow = {
  visited_at: string;
  restaurant_id: string;
  restaurant: {
    google_place_id: string;
    name: string;
    chain_name: string | null;
    primary_type: string | null;
    cuisine_type: string | null;
    neighborhood: string | null;
    tags: string[] | null;
    price_level: number | null;
    rating: number | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
};

export async function analyzeWeeklyPalate(
  weekStart: string,
  weekEnd: string,
): Promise<PalateInsight> {
  const startISO = new Date(`${weekStart}T00:00:00Z`).toISOString();
  // weekEnd is inclusive — bump to end of day
  const endISO = new Date(`${weekEnd}T23:59:59Z`).toISOString();

  const { data, error } = await supabase
    .from("visits")
    .select(`
      visited_at, restaurant_id,
      restaurant:restaurants (
        google_place_id, name, chain_name, primary_type,
        cuisine_type, neighborhood, tags,
        price_level, rating, address, latitude, longitude
      )
    `)
    .gte("visited_at", startISO)
    .lte("visited_at", endISO)
    .order("visited_at", { ascending: false });

  if (error) throw error;
  const visits = (data ?? []) as unknown as WeeklyVisitRow[];

  const cuisineCounts: Record<string, number> = {};
  const traitCounts: Record<PalateTrait, number> = {} as Record<PalateTrait, number>;
  const seenPlaces = new Set<string>();
  let anchorPlaceId: string | null = null;
  let anchorLatLng: { lat: number; lng: number } | null = null;

  for (const v of visits) {
    const r = v.restaurant;
    if (!r) continue;
    seenPlaces.add(r.google_place_id);

    const cuisine = inferCuisine(r);
    if (cuisine) cuisineCounts[cuisine] = (cuisineCounts[cuisine] ?? 0) + 1;

    for (const t of inferTraits(r, cuisine)) {
      traitCounts[t] = (traitCounts[t] ?? 0) + 1;
    }

    // Anchor = most recent visit with usable coords
    if (!anchorLatLng && r.latitude != null && r.longitude != null) {
      anchorLatLng = { lat: r.latitude, lng: r.longitude };
      anchorPlaceId = r.google_place_id;
    }
  }

  const sortedCuisines = Object.entries(cuisineCounts).sort((a, b) => b[1] - a[1]);
  const sortedTraits = (Object.entries(traitCounts) as Array<[PalateTrait, number]>)
    .sort((a, b) => b[1] - a[1]);

  const primaryCuisine = sortedCuisines[0]?.[0] ?? null;
  const dominantTrait = sortedTraits[0]?.[0] ?? null;
  // Experimental trait = a less-frequent trait that genuinely differs from
  // the dominant one. Skip if there's only one trait or they're too similar.
  const experimentalTrait =
    sortedTraits.find(([t, c]) => t !== dominantTrait && c >= 1)?.[0] ?? null;

  const topVisit = visits.find((v) => v.restaurant?.name)?.restaurant ?? null;

  const insight: PalateInsight = {
    weekStart,
    weekEnd,
    visitCount: visits.length,
    uniqueRestaurantCount: seenPlaces.size,
    primaryCuisine,
    cuisineCounts,
    dominantTrait,
    experimentalTrait,
    topRestaurantName: topVisit?.name ?? null,
    anchorPlaceId,
    anchorLatLng,
    copy: "",
    isLowData: visits.length < 3,
  };
  insight.copy = buildHeadline(insight);
  return insight;
}

// ============================================================================
// Public: getPalateRecommendations
// ----------------------------------------------------------------------------
// Strategy:
//   1. Find candidates near the anchor (most-recent week visit's lat/lng).
//   2. Drop anything the user already visited this week.
//   3. Score each remaining candidate for similarity to the user's pattern.
//   4. Return top 3 "similar" + 1 "stretch" (different cuisine / format).
// If there's no anchor (low data, no location), fall back to the current
// location passed in by the caller, or return empty arrays.
// ============================================================================

export async function getPalateRecommendations(
  insight: PalateInsight,
  fallbackAnchor?: { lat: number; lng: number },
): Promise<PalateRecommendations> {
  // Anchor priority:
  //   1. Most-recent visit *this week* with a real lat/lng (set by analyzer)
  //   2. Caller-supplied current-location fallback
  //   3. Most-recent ping in location_events for this user (no permission ask)
  let anchor = insight.anchorLatLng ?? fallbackAnchor ?? null;
  if (!anchor) {
    anchor = await lastKnownLocation();
  }
  if (!anchor) {
    return { similar: [], stretch: null };
  }

  // 500m default; broaden when low data so the suggestion list isn't empty.
  const radius = insight.isLowData ? 1200 : 800;
  const candidates = await nearbyRestaurants(anchor.lat, anchor.lng, radius);

  // Dedupe against this week's visits
  const visitedPlaceIds = await getVisitedPlaceIds(insight.weekStart, insight.weekEnd);

  const enriched = candidates
    .filter((c) => !visitedPlaceIds.has(c.google_place_id))
    .map((c) => {
      const cuisine = inferCuisine(c);
      return {
        place: c,
        cuisine,
        traits: inferTraits(c, cuisine),
      };
    });

  // SIMILAR: same cuisine as primary (or shared traits if no cuisine match).
  const similarRanked = enriched
    .map((e) => {
      let score = 0;
      if (insight.primaryCuisine && e.cuisine === insight.primaryCuisine) score += 5;
      if (insight.dominantTrait && e.traits.includes(insight.dominantTrait)) score += 3;
      if (e.place.rating != null) score += Math.min(e.place.rating - 3.5, 1.5);
      return { ...e, score };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);

  const similar = similarRanked.slice(0, 3).map((e) => toRec(
    e.place,
    e.cuisine,
    similarReasonFor(e.cuisine, insight),
  ));

  // STRETCH: pick one that is meaningfully *different* but still plausible.
  // - different cuisine from primary
  // - prefer something with the experimentalTrait if we found one
  // - or different price tier from the user's pattern
  const stretchCandidate = enriched
    .filter((e) => e.cuisine && e.cuisine !== insight.primaryCuisine)
    .map((e) => {
      let score = 0;
      if (insight.experimentalTrait && e.traits.includes(insight.experimentalTrait)) score += 4;
      if (e.cuisine && !insight.cuisineCounts[e.cuisine]) score += 2; // brand new cuisine
      if (e.place.rating != null && e.place.rating >= 4.2) score += 2;
      return { ...e, score };
    })
    .sort((a, b) => b.score - a.score)[0];

  const stretch = stretchCandidate
    ? toRec(stretchCandidate.place, stretchCandidate.cuisine, stretchReasonFor(stretchCandidate.cuisine, insight))
    : null;

  return { similar, stretch };
}

function toRec(place: Restaurant, cuisine: string | null, reason: string): RestaurantRecommendation {
  return {
    google_place_id: place.google_place_id,
    name: place.name,
    cuisine,
    // Prefer the server-populated neighborhood; parse the address as fallback.
    neighborhood: place.neighborhood ?? neighborhoodFromAddress(place.address),
    reason,
    price_level: place.price_level ?? null,
    rating: place.rating ?? null,
  };
}

function similarReasonFor(cuisine: string | null, i: PalateInsight): string {
  if (cuisine && cuisine === i.primaryCuisine) {
    const display = CUISINE_DISPLAY[cuisine] ?? cuisine;
    return `More ${display} — your week was full of it`;
  }
  if (i.dominantTrait) {
    return `${TRAIT_DISPLAY[i.dominantTrait][0].toUpperCase() + TRAIT_DISPLAY[i.dominantTrait].slice(1)} energy, like your usual spots`;
  }
  return "Close to your usual spots";
}

function stretchReasonFor(cuisine: string | null, i: PalateInsight): string {
  if (cuisine && cuisine !== i.primaryCuisine) {
    const display = CUISINE_DISPLAY[cuisine] ?? cuisine;
    if (i.experimentalTrait) {
      return `${display} — leans into the ${TRAIT_DISPLAY[i.experimentalTrait]} side you've been exploring`;
    }
    return `${display} — a new lane for your Palate`;
  }
  return "Worth a left turn this week";
}

/**
 * Most recent location ping for the signed-in user. Uses already-collected
 * data from `location_events` — does NOT trigger a fresh permission prompt.
 * Returns null if the user has never granted location.
 */
async function lastKnownLocation(): Promise<{ lat: number; lng: number } | null> {
  const { data } = await supabase
    .from("location_events")
    .select("latitude, longitude")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data || data.latitude == null || data.longitude == null) return null;
  return { lat: data.latitude as number, lng: data.longitude as number };
}

async function getVisitedPlaceIds(weekStart: string, weekEnd: string): Promise<Set<string>> {
  const startISO = new Date(`${weekStart}T00:00:00Z`).toISOString();
  const endISO = new Date(`${weekEnd}T23:59:59Z`).toISOString();
  const { data } = await supabase
    .from("visits")
    .select("restaurant:restaurants ( google_place_id )")
    .gte("visited_at", startISO)
    .lte("visited_at", endISO);
  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<{ restaurant: { google_place_id: string } | null }>) {
    if (row.restaurant?.google_place_id) ids.add(row.restaurant.google_place_id);
  }
  return ids;
}

// ============================================================================
// Public: leaningPersonality
// ----------------------------------------------------------------------------
// Mid-week classifier — predicts which Sunday personality the user is
// trending toward, based on their week-so-far insight. Returns null when
// there isn't enough signal yet (so callers can show "still warming up"
// instead of guessing).
// ============================================================================

export function leaningPersonality(insight: PalateInsight): string | null {
  if (insight.visitCount === 0) return null;

  const repeats = insight.visitCount - insight.uniqueRestaurantCount;
  const repeatRate = insight.visitCount > 0 ? repeats / insight.visitCount : 0;
  const exploreRate = insight.uniqueRestaurantCount / Math.max(insight.visitCount, 1);

  // Strong signals first
  if (insight.visitCount >= 3 && repeatRate >= 0.5) return "The Loyalist";
  if (insight.visitCount >= 5 && exploreRate >= 0.8) return "The Explorer";

  // Trait-based leans
  if (insight.dominantTrait === "café") return "The Café Dweller";
  if (insight.primaryCuisine === "healthy" || insight.dominantTrait === "healthy") {
    return "The Fast Casual Regular";
  }
  if (insight.dominantTrait === "comfort" || insight.primaryCuisine === "italian") {
    return "The Comfort Food Connoisseur";
  }

  // Not enough signal
  return null;
}

/**
 * Days until next Sunday (when the week's Wrapped lands).
 * Returns 0 on Sunday itself.
 */
export function daysUntilSundayWrap(now = new Date()): number {
  const dow = now.getDay(); // 0 = Sunday
  return (7 - dow) % 7;
}

// ============================================================================
// Public: addToWishlist
// ----------------------------------------------------------------------------
// Requires the wishlist table from supabase/migrations/0003_wishlist.sql.
// Falls back to a friendly error message if the table isn't there yet.
// ============================================================================

export async function addToWishlist(googlePlaceId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: rest, error: lookupErr } = await supabase
    .from("restaurants")
    .select("id")
    .eq("google_place_id", googlePlaceId)
    .single();
  if (lookupErr) throw lookupErr;

  const { error } = await supabase.from("wishlist").insert({
    user_id: user.id,
    restaurant_id: rest.id,
    source: "palate_insights",
  });
  // Ignore unique-violation: re-saving is a no-op.
  if (error && !`${error.message}`.includes("duplicate")) throw error;
}

// ============================================================================
// Public: list + remove for the Wishlist tab
// ============================================================================

export type WishlistEntry = {
  id: string;
  added_at: string;
  source: string | null;
  restaurant: {
    id: string;
    google_place_id: string;
    name: string;
    cuisine_type: string | null;
    neighborhood: string | null;
    address: string | null;
    primary_type: string | null;
    price_level: number | null;
  } | null;
};

export async function listWishlist(): Promise<WishlistEntry[]> {
  const { data, error } = await supabase
    .from("wishlist")
    .select(`
      id, added_at, source,
      restaurant:restaurants (
        id, google_place_id, name, cuisine_type, neighborhood,
        address, primary_type, price_level
      )
    `)
    .order("added_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as WishlistEntry[];
}

export async function removeFromWishlist(wishlistId: string): Promise<void> {
  const { error } = await supabase.from("wishlist").delete().eq("id", wishlistId);
  if (error) throw error;
}
