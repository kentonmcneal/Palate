// Palate — Places API proxy
//
// Why this exists:
//   We never expose the Google Places API key to the mobile app. The app calls
//   THIS function with the user's Supabase JWT, and we call Google with our
//   server-side key. Cost-controls and caching live here.
//
// Endpoints (POST):
//   action: "nearby"  — body: { lat, lng, radius_m? }      → returns nearby restaurants
//   action: "details" — body: { place_id }                 → returns one place
//   action: "search"  — body: { query, lat?, lng? }        → text search
//
// Caching:
//   - Nearby results are cached in the public.restaurants table by place_id
//   - We refuse a "nearby" call from the same user within 60 seconds (rate limit)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const GOOGLE_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESTAURANT_TYPES = [
  "restaurant",
  "cafe",
  "bakery",
  "bar",
  "meal_takeaway",
  "meal_delivery",
];

const NEARBY_RATE_LIMIT_SECONDS = 60;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- auth: read the user from the JWT Supabase forwarded ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "missing auth" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser(jwt);
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    // service-role client for inserts that bypass RLS where needed
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === "nearby") {
      return await handleNearby(body, user.id, adminClient);
    }
    if (action === "details") {
      return await handleDetails(body, adminClient);
    }
    if (action === "search") {
      return await handleSearch(body, adminClient);
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

// ----- handlers ---------------------------------------------------------

async function handleNearby(
  body: { lat?: number; lng?: number; radius_m?: number },
  userId: string,
  admin: ReturnType<typeof createClient>,
) {
  const { lat, lng } = body;
  const radius = Math.min(body.radius_m ?? 150, 500);
  if (typeof lat !== "number" || typeof lng !== "number") {
    return json({ error: "lat/lng required" }, 400);
  }

  // rate-limit: latest location_events for this user in the last 60s
  const cutoff = new Date(Date.now() - NEARBY_RATE_LIMIT_SECONDS * 1000).toISOString();
  const { count } = await admin
    .from("location_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("captured_at", cutoff);

  if ((count ?? 0) > 5) {
    return json({ error: "rate_limited" }, 429);
  }

  // call Google Places API (New) — searchNearby
  const resp = await fetch(
    "https://places.googleapis.com/v1/places:searchNearby",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_KEY,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.addressComponents,places.location,places.primaryType,places.types,places.priceLevel,places.rating,places.userRatingCount",
      },
      body: JSON.stringify({
        includedTypes: RESTAURANT_TYPES,
        maxResultCount: 10,
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius,
          },
        },
      }),
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    console.error("google nearby failed", resp.status, text);
    return json({ error: "places_failed", detail: text }, 502);
  }

  const data = await resp.json();
  const places = (data.places ?? []) as GooglePlace[];

  // upsert into restaurants table so the mobile app can foreign-key to them
  const rows = places.map(googleToRestaurantRow);
  if (rows.length) {
    await admin.from("restaurants").upsert(rows, { onConflict: "google_place_id" });
  }

  return json({ places: rows });
}

async function handleDetails(
  body: { place_id?: string },
  admin: ReturnType<typeof createClient>,
) {
  const placeId = body.place_id;
  if (!placeId) return json({ error: "place_id required" }, 400);

  // Try the cache first.
  const { data: cached } = await admin
    .from("restaurants")
    .select("*")
    .eq("google_place_id", placeId)
    .maybeSingle();

  if (cached && new Date(cached.refreshed_at).getTime() > Date.now() - 30 * 24 * 3600 * 1000) {
    return json({ place: cached });
  }

  const resp = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask":
        "id,displayName,formattedAddress,shortFormattedAddress,addressComponents,location,primaryType,types,priceLevel,rating,userRatingCount",
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    return json({ error: "places_failed", detail: text }, 502);
  }
  const place = await resp.json() as GooglePlace;
  const row = googleToRestaurantRow(place);
  await admin.from("restaurants").upsert(row, { onConflict: "google_place_id" });
  return json({ place: row });
}

async function handleSearch(
  body: { query?: string; lat?: number; lng?: number },
  admin: ReturnType<typeof createClient>,
) {
  if (!body.query) return json({ error: "query required" }, 400);

  const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.addressComponents,places.location,places.primaryType,places.types,places.priceLevel,places.rating,places.userRatingCount",
    },
    body: JSON.stringify({
      textQuery: body.query,
      includedType: "restaurant",
      maxResultCount: 10,
      // (FieldMask below picks up address components for neighborhood parsing)
      ...(typeof body.lat === "number" && typeof body.lng === "number"
        ? {
            locationBias: {
              circle: {
                center: { latitude: body.lat, longitude: body.lng },
                radius: 5000,
              },
            },
          }
        : {}),
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return json({ error: "places_failed", detail: text }, 502);
  }

  const data = await resp.json();
  const places = (data.places ?? []) as GooglePlace[];
  const rows = places.map(googleToRestaurantRow);
  if (rows.length) {
    await admin.from("restaurants").upsert(rows, { onConflict: "google_place_id" });
  }
  return json({ places: rows });
}

// ----- helpers ----------------------------------------------------------

interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  priceLevel?: string; // "PRICE_LEVEL_INEXPENSIVE" etc.
  rating?: number;
  userRatingCount?: number;
}

const PRICE_LEVEL_MAP: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

// --- cuisine inference from Google's types[] ---
// Google's "Places API (New)" emits granular types like `pizza_restaurant`,
// `sushi_restaurant`, `chinese_restaurant`. We map them to a normalized
// vocabulary used app-wide. First match wins.
const CUISINE_TYPE_MAP: Record<string, string> = {
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

function inferCuisineFromTypes(types: string[]): string | null {
  for (const t of types) {
    const c = CUISINE_TYPE_MAP[t];
    if (c) return c;
  }
  return null;
}

// ============================================================================
// Palate Feature Engine — additional restaurant tag dimensions.
// All inferences are from food behavior, restaurant metadata, and location
// patterns only. No protected-class inference.
// ============================================================================

// Granular subregion inference — runs name + types + cuisine through a small
// keyword classifier. Order matters; first hit wins.
const SUBREGION_RULES: Array<{ match: (name: string, types: string[]) => boolean; subregion: string; region: string }> = [
  // Southern US BBQ subregions
  { match: (n) => /memphis/i.test(n) && /bbq|smoke|rib/i.test(n),  subregion: "memphis_bbq",   region: "southern_us" },
  { match: (n) => /(kansas city|k\.c\.) ?bbq/i.test(n),            subregion: "kc_bbq",        region: "southern_us" },
  { match: (n) => /texas|brisket/i.test(n) && /bbq|smoke/i.test(n),subregion: "texas_bbq",     region: "southern_us" },
  { match: (n) => /nashville hot/i.test(n),                        subregion: "nashville_hot", region: "southern_us" },
  { match: (n) => /cajun|creole|gumbo/i.test(n),                   subregion: "cajun",         region: "southern_us" },
  { match: (n) => /soul ?food|chicken & waffles/i.test(n),         subregion: "soul_food",     region: "southern_us" },
  // Korean / Korean BBQ
  { match: (n, t) => t.includes("korean_restaurant") && /bbq|kbbq|gogi|ssam/i.test(n), subregion: "korean_bbq", region: "east_asian" },
  { match: (_, t) => t.includes("korean_restaurant"),              subregion: "korean",        region: "east_asian" },
  // Japanese subregions
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
  // Italian
  { match: (n) => /neapolitan|pizzeria napoletana/i.test(n),       subregion: "italian_neapolitan", region: "italian" },
  { match: (n) => /trattoria|osteria/i.test(n),                    subregion: "italian_trattoria", region: "italian" },
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
  { match: (n, t) => t.includes("pizza_restaurant") && /(ny|new york|joe's)/i.test(n), subregion: "pizza_nyc", region: "american" },
  { match: (n) => /chicago deep dish|deep dish/i.test(n),          subregion: "pizza_chicago", region: "american" },
  { match: (n) => /diner|breakfast|pancake/i.test(n),              subregion: "breakfast_diner", region: "american" },
  { match: (_, t) => t.includes("hamburger_restaurant"),           subregion: "burger",        region: "american" },
  { match: (n) => /bodega|corner store/i.test(n),                  subregion: "bodega_food",   region: "american" },
  // Bar / wine / fine dining catch-alls
  { match: (n) => /wine bar|enoteca/i.test(n),                     subregion: "wine_bar_food", region: "european" },
  { match: (n) => /steakhouse|chop house/i.test(n),                subregion: "steakhouse",    region: "american" },
  { match: (n) => /seafood|oyster|raw bar/i.test(n),               subregion: "seafood_house", region: "american" },
  // BBQ catch-all
  { match: (_, t) => t.includes("barbecue_restaurant"),            subregion: "bbq_general",   region: "southern_us" },
  // Brunch / café
  { match: (n) => /brunch|breakfast/i.test(n),                     subregion: "brunch_modern", region: "american" },
  { match: (_, t) => t.includes("coffee_shop") || t.includes("cafe"), subregion: "café",       region: "café_culture" },
];

function inferSubregion(name: string, types: string[]): { subregion: string | null; region: string | null } {
  for (const rule of SUBREGION_RULES) {
    if (rule.match(name, types)) return { subregion: rule.subregion, region: rule.region };
  }
  return { subregion: null, region: null };
}

function inferFormatClass(types: string[], priceLevel: number | null): string {
  if (types.includes("bar") || types.includes("pub")) return "bar";
  if (types.includes("wine_bar")) return "wine_bar";
  if (types.includes("coffee_shop") || types.includes("cafe")) return "café";
  if (types.includes("meal_delivery")) return "ghost_kitchen";
  if (types.includes("meal_takeaway")) return "quick_service";
  if (types.includes("fast_food_restaurant")) return "quick_service";
  if (priceLevel != null && priceLevel >= 4) return "fine_dining";
  if (priceLevel != null && priceLevel >= 3) return "casual_dining";
  if (priceLevel != null && priceLevel <= 1) return "quick_service";
  return "fast_casual";
}

// Chain affiliation — uses the existing detected chain name + a small set of
// regional vs national heuristics.
const NATIONAL_CHAINS = new Set([
  "Starbucks", "McDonald's", "Subway", "Chipotle", "Chick-fil-A",
  "Shake Shack", "Sweetgreen", "Dunkin", "Panera", "Five Guys",
  "Taco Bell", "Wendy's", "Burger King", "Popeyes", "Cava", "Pret",
]);
function inferChainType(name: string, chainName: string | null): string {
  if (!chainName) return "independent";
  if (NATIONAL_CHAINS.has(chainName)) return "national_chain";
  // Heuristic: if the name has a multi-location feel ("& Sons", "Pizza Co."), probably local chain
  if (/(\bgroup\b|\bco\.|\& sons|\bbrothers\b)/i.test(name)) return "local_chain";
  return "regional_chain";
}

function inferOccasionTags(formatClass: string, priceLevel: number | null, types: string[]): string[] {
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

function inferFlavorTags(cuisine: string | null, subregion: string | null): string[] {
  const tags = new Set<string>();
  // Smoke
  if (subregion?.includes("bbq") || subregion === "memphis_bbq" || subregion === "kc_bbq" || subregion === "texas_bbq") {
    tags.add("smoky"); tags.add("char"); tags.add("rich");
  }
  // Spicy
  if (cuisine === "mexican" || cuisine === "thai" || cuisine === "indian" || cuisine === "korean") tags.add("spicy");
  if (subregion === "nashville_hot" || subregion === "chinese_szechuan") tags.add("spicy");
  // Umami / savory
  if (cuisine === "japanese" || subregion === "japanese_ramen" || subregion?.includes("korean")) {
    tags.add("umami"); tags.add("savory");
  }
  // Fresh / light
  if (cuisine === "healthy" || subregion === "japanese_sushi") { tags.add("fresh"); tags.add("light"); }
  // Sweet
  if (cuisine === "bakery" || cuisine === "dessert") tags.add("sweet");
  // Rich / comfort
  if (cuisine === "italian" || cuisine === "american" || cuisine === "bbq" || cuisine === "steakhouse") tags.add("rich");
  return [...tags];
}

function inferCulturalContext(chainType: string, priceLevel: number | null, ratingCount: number | null): string {
  if (chainType === "national_chain") return "comfort";
  if (priceLevel != null && priceLevel >= 4) return "modernist";
  if (ratingCount != null && ratingCount < 50) return "hidden";
  if (ratingCount != null && ratingCount > 5000) return "trending";
  return "heritage";
}

// --- trait derivation, matches mobile/lib/palate-insights.ts ---
function deriveTags(cuisine: string | null, primaryType: string | null, priceLevel: number | null): string[] {
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

// --- neighborhood from structured address components, with fallback ---
// Google's `addressComponents` includes a "neighborhood" or "sublocality"
// type for most US/EU urban places. Sometimes it's missing — fall back to
// parsing the formatted address (second-to-last segment).
function neighborhoodFromPlace(p: GooglePlace): string | null {
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
  // Drop the trailing "City, State Zip" segment if present.
  if (parts.length >= 3) return parts[parts.length - 3] ?? null;
  if (parts.length === 2) return parts[0] ?? null;
  return null;
}

function googleToRestaurantRow(p: GooglePlace) {
  const name = p.displayName?.text ?? "Unknown";
  const types = p.types ?? [];
  const primaryType = p.primaryType ?? types[0] ?? null;
  const cuisine = inferCuisineFromTypes(types);
  const price = p.priceLevel ? PRICE_LEVEL_MAP[p.priceLevel] ?? null : null;
  const tags = deriveTags(cuisine, primaryType, price);

  // Palate Feature Engine derivations
  const { subregion, region } = inferSubregion(name, types);
  const formatClass = inferFormatClass(types, price);
  const chainName = detectChain(name);
  const chainType = inferChainType(name, chainName);
  const occasionTags = inferOccasionTags(formatClass, price, types);
  const flavorTags = inferFlavorTags(cuisine, subregion);
  const culturalContext = inferCulturalContext(chainType, price, p.userRatingCount ?? null);

  return {
    google_place_id: p.id,
    name,
    chain_name: chainName,
    address: p.shortFormattedAddress ?? p.formattedAddress ?? null,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    primary_type: primaryType,
    types: types.length ? types : null,
    cuisine_type: cuisine,
    cuisine_region: region,
    cuisine_subregion: subregion,
    format_class: formatClass,
    chain_type: chainType,
    occasion_tags: occasionTags.length ? occasionTags : null,
    flavor_tags: flavorTags.length ? flavorTags : null,
    cultural_context: culturalContext,
    neighborhood: neighborhoodFromPlace(p),
    tags: tags.length ? tags : null,
    price_level: price,
    rating: p.rating ?? null,
    user_rating_count: p.userRatingCount ?? null,
    refreshed_at: new Date().toISOString(),
  };
}

const KNOWN_CHAINS = [
  "Starbucks", "McDonald's", "Chipotle", "Sweetgreen", "Chick-fil-A",
  "Shake Shack", "Subway", "Dunkin", "Panera", "Five Guys", "In-N-Out",
  "Taco Bell", "Wendy's", "Burger King", "Popeyes", "Cava", "Pret",
  "Whole Foods", "Trader Joe's",
];
function detectChain(name: string): string | null {
  for (const c of KNOWN_CHAINS) {
    if (name.toLowerCase().startsWith(c.toLowerCase())) return c;
  }
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
