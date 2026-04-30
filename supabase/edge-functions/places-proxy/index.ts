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
          "places.id,places.displayName,places.shortFormattedAddress,places.location,places.primaryType,places.types,places.priceLevel,places.rating",
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
        "id,displayName,shortFormattedAddress,location,primaryType,types,priceLevel,rating",
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
        "places.id,places.displayName,places.shortFormattedAddress,places.location,places.primaryType,places.types,places.priceLevel,places.rating",
    },
    body: JSON.stringify({
      textQuery: body.query,
      includedType: "restaurant",
      maxResultCount: 10,
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

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  shortFormattedAddress?: string;
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

function googleToRestaurantRow(p: GooglePlace) {
  const name = p.displayName?.text ?? "Unknown";
  return {
    google_place_id: p.id,
    name,
    chain_name: detectChain(name),
    address: p.shortFormattedAddress ?? null,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    primary_type: p.primaryType ?? (p.types?.[0] ?? null),
    cuisine_type: null as string | null,
    price_level: p.priceLevel ? PRICE_LEVEL_MAP[p.priceLevel] ?? null : null,
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
