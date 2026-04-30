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
          "places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.addressComponents,places.location,places.primaryType,places.types,places.priceLevel,places.rating",
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
        "id,displayName,formattedAddress,shortFormattedAddress,addressComponents,location,primaryType,types,priceLevel,rating",
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
        "places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.addressComponents,places.location,places.primaryType,places.types,places.priceLevel,places.rating",
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

  return {
    google_place_id: p.id,
    name,
    chain_name: detectChain(name),
    address: p.shortFormattedAddress ?? p.formattedAddress ?? null,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    primary_type: primaryType,
    cuisine_type: cuisine,
    neighborhood: neighborhoodFromPlace(p),
    tags: tags.length ? tags : null,
    price_level: price,
    rating: p.rating ?? null,
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
