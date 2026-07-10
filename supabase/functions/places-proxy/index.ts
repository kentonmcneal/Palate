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
import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import {
  CLASSIFIER_VERSION,
  deriveClassification,
  type GooglePlace,
  googleToRestaurantRow,
  PRICE_LEVEL_MAP,
} from "../_shared/classifier.ts";
import {
  classifyWithLLM,
  type LLMInput,
  mergeLLMIntoDerivation,
  shouldEnrichQualitative,
  shouldUseLLM,
} from "../_shared/llm-classifier.ts";

const GOOGLE_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Optional — when unset, the LLM fallback is a no-op and places-proxy keeps
// behaving as before. Add via: supabase secrets set ANTHROPIC_API_KEY=sk-...
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

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

// Server-side guards. The map covers a wide area, so the radius cap is
// generous; Google charges per call (not per result), so a larger radius +
// higher result count means FEWER calls to fill the map, not more spend.
const NEARBY_MAX_RADIUS_M = 3000;       // was 500 — caused the "pins stop on pan" bug
const NEARBY_DEFAULT_RADIUS_M = 1500;
const NEARBY_MAX_RESULTS = 20;          // was 10 — same per-call price, more pins

// Coarse abuse ceiling only. Normal panning is bounded client-side (debounce +
// distance threshold + cache), so this just stops a runaway/looping client. It
// counts the user's own recent location activity as a rough proxy.
const NEARBY_RATE_LIMIT_SECONDS = 60;
const NEARBY_RATE_LIMIT_MAX = 40;       // was effectively 5 — far too low for a pan-to-refetch map

// ----- Cost controls ----------------------------------------------------
// Daily ceiling on *billable* Google Places calls (nearby, search, and
// details cache-misses). When today's count hits the cap the proxy stops
// calling Google and serves cached/DB results until the next UTC day. Default
// ~1500/day (~$48/day worst case at Pro pricing); raise via env as you scale.
const GOOGLE_DAILY_CALL_CAP = Number(Deno.env.get("GOOGLE_DAILY_CALL_CAP") ?? "1500");
// Founder's own Expo push token (ExponentPushToken[...]). Receives the 80%
// warning and the kill-switch-tripped alert. When unset, alerts are skipped
// silently (the kill-switch itself still works).
const ALERT_PUSH_TOKEN = Deno.env.get("ALERT_PUSH_TOKEN") ?? "";

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
    if (action === "blurb") {
      return await handleBlurb(body, adminClient);
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
  const radius = Math.min(body.radius_m ?? NEARBY_DEFAULT_RADIUS_M, NEARBY_MAX_RADIUS_M);
  if (typeof lat !== "number" || typeof lng !== "number") {
    return json({ error: "lat/lng required" }, 400);
  }

  // Coarse abuse ceiling: bail only if this user has been extremely active in
  // the last minute. Normal map panning stays well under this.
  const cutoff = new Date(Date.now() - NEARBY_RATE_LIMIT_SECONDS * 1000).toISOString();
  const { count } = await admin
    .from("location_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("captured_at", cutoff);

  if ((count ?? 0) > NEARBY_RATE_LIMIT_MAX) {
    return json({ error: "rate_limited" }, 429);
  }

  // Kill-switch: if today's Google budget is spent, serve best-effort results
  // from the cached restaurants instead of calling Google.
  if (await isTripped(admin)) {
    const places = await degradedNearby(admin, lat, lng, radius);
    await recordUsage(admin, "nearby", "cache");
    return json({ places, degraded: true });
  }
  await reserveGoogleCall(admin);

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
        maxResultCount: NEARBY_MAX_RESULTS,
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

  // Bulk endpoint: deterministic classification only. The `details` endpoint
  // upgrades to LLM-augmented classification when the user taps a place.
  const rows = await Promise.all(
    places.map((p) => classifyAndBuildRow(p, { useLLM: false, admin })),
  );
  if (rows.length) {
    await admin.from("restaurants").upsert(rows, { onConflict: "google_place_id" });
  }

  await recordUsage(admin, "nearby", "google");
  return json({ places: rows });
}

async function handleDetails(
  body: { place_id?: string },
  admin: ReturnType<typeof createClient>,
) {
  const placeId = body.place_id;
  if (!placeId) return json({ error: "place_id required" }, 400);

  // Try the cache first. Cache is valid only if the row was classified by
  // the current classifier version AND refreshed within the TTL — otherwise
  // we re-call Google and re-classify so version bumps propagate.
  const { data: cached } = await admin
    .from("restaurants")
    .select("*")
    .eq("google_place_id", placeId)
    .maybeSingle();

  const cacheFresh = cached
    && cached.classifier_version === CLASSIFIER_VERSION
    && new Date(cached.refreshed_at).getTime() > Date.now() - 30 * 24 * 3600 * 1000;

  if (cacheFresh) {
    await recordUsage(admin, "details", "cache");
    return json({ place: cached });
  }

  // Kill-switch: budget spent — return the stale cached row if we have one,
  // rather than paying Google for a refresh. Only 503 when we have nothing.
  if (await isTripped(admin)) {
    if (cached) {
      await recordUsage(admin, "details", "cache");
      return json({ place: cached, degraded: true });
    }
    return json({ error: "temporarily_unavailable", degraded: true }, 503);
  }
  await reserveGoogleCall(admin);

  // Details endpoint requests the richer fields (editorialSummary, reviews)
  // because this is the LLM-augmented path — those become inputs to the LLM
  // classifier and to the review-text miner.
  const resp = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask":
        "id,displayName,formattedAddress,shortFormattedAddress,addressComponents,location,primaryType,types,priceLevel,rating,userRatingCount,editorialSummary,reviews,goodForGroups,goodForChildren,menuForChildren,goodForWatchingSports,liveMusic,reservable,outdoorSeating,servesBreakfast,servesBrunch,servesLunch,servesDinner,servesBeer,servesWine,servesCocktails,servesVegetarianFood,servesDessert,allowsDogs,delivery,takeout,dineIn",
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    return json({ error: "places_failed", detail: text }, 502);
  }
  const place = await resp.json() as GooglePlace;
  const row = await classifyAndBuildRow(place, { useLLM: true, admin });
  await admin.from("restaurants").upsert(row, { onConflict: "google_place_id" });
  await recordUsage(admin, "details", "google");
  return json({ place: row });
}

async function handleSearch(
  body: { query?: string; lat?: number; lng?: number },
  admin: ReturnType<typeof createClient>,
) {
  if (!body.query) return json({ error: "query required" }, 400);

  // Kill-switch: text search is a relevance-ranked query we can't faithfully
  // serve from the DB, so when the budget is spent we return empty with a
  // degraded flag rather than a low-quality guess.
  if (await isTripped(admin)) {
    await recordUsage(admin, "search", "cache");
    return json({ places: [], degraded: true });
  }
  await reserveGoogleCall(admin);

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
  const rows = await Promise.all(
    places.map((p) => classifyAndBuildRow(p, { useLLM: false, admin })),
  );
  if (rows.length) {
    await admin.from("restaurants").upsert(rows, { onConflict: "google_place_id" });
  }
  await recordUsage(admin, "search", "google");
  return json({ places: rows });
}

// ----- editorial blurb --------------------------------------------------

const BLURB_SYSTEM = `Write a single-sentence editorial description of a restaurant — what it's famous for, what the vibe is, who it's for. Under 22 words. Active voice. Specific. No "delicious" or "amazing"; show, don't tell.

Format: just the sentence. No quotes, no preamble.

Examples:
- Hand-pulled noodles and aggressive Sichuan spice in a no-frills room.
- Hyper-seasonal pasta menu that changes daily; book three weeks out.
- Late-night dive with $4 pierogi and a Polish Hill crowd.
- Date-night Greek with a Center City wine list and patio seats by 8.

Avoid: "A great place to eat...", "This restaurant serves...", "If you like X, you'll love...".`;

async function handleBlurb(
  body: { place_id?: string },
  admin: ReturnType<typeof createClient>,
) {
  const placeId = body.place_id;
  if (!placeId) return json({ error: "place_id required" }, 400);

  const { data: rest } = await admin
    .from("restaurants")
    .select("id, name, cuisine_type, cuisine_subregion, neighborhood, review_snippets, editorial_summary, editorial_blurb, editorial_blurb_generated_at, reviews_refreshed_at")
    .eq("google_place_id", placeId)
    .maybeSingle();
  if (!rest) return json({ error: "not_found" }, 404);

  // Cache is valid when the blurb exists AND was generated after the last
  // review refresh (or there's no review refresh timestamp at all). No
  // client-controlled `force=true` — that would be a cost-spam vector (any
  // authenticated user could trigger LLM regen at will). Invalidation goes
  // through the backfill script or a direct SQL update by an admin.
  const cacheValid = rest.editorial_blurb
    && rest.editorial_blurb_generated_at
    && (!rest.reviews_refreshed_at
        || new Date(rest.editorial_blurb_generated_at).getTime()
           >= new Date(rest.reviews_refreshed_at).getTime());
  if (cacheValid) {
    return json({ blurb: rest.editorial_blurb });
  }

  if (!anthropic) {
    return json({ blurb: null, reason: "no_llm_configured" });
  }
  const snippets: string[] = rest.review_snippets ?? [];
  if (snippets.length === 0 && !rest.editorial_summary) {
    return json({ blurb: null, reason: "no_reviews" });
  }

  const parts: string[] = [
    `Name: ${rest.name}`,
    `Cuisine: ${rest.cuisine_subregion ?? rest.cuisine_type ?? "unknown"}`,
    `Neighborhood: ${rest.neighborhood ?? "unknown"}`,
  ];
  if (rest.editorial_summary) parts.push(`Editorial summary: ${rest.editorial_summary}`);
  if (snippets.length > 0) {
    parts.push("Review snippets:");
    for (const s of snippets.slice(0, 5)) parts.push(`- ${s.slice(0, 240)}`);
  }
  parts.push("\nReturn the single sentence.");

  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 80,
      system: [{ type: "text", text: BLURB_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: parts.join("\n") }],
    });
    const textBlock = resp.content.find((c) => c.type === "text");
    const blurb = textBlock?.text?.trim()?.replace(/^["']|["']$/g, "") ?? null;
    if (blurb) {
      await admin.from("restaurants").update({
        editorial_blurb: blurb,
        editorial_blurb_generated_at: new Date().toISOString(),
      }).eq("id", rest.id);
    }
    return json({ blurb });
  } catch (e) {
    console.error("blurb generation failed", e);
    return json({ error: String(e) }, 500);
  }
}

// ----- helpers ----------------------------------------------------------

// Build the DB row for a place, optionally augmented by the LLM when the
// deterministic classifier was uncertain. The LLM only runs when we have
// an API key, are explicitly asked to (`useLLM`), and rule confidence is
// below threshold — bulk endpoints (nearby/search) skip it to keep costs
// predictable; only `details` opts in.
async function classifyAndBuildRow(
  place: GooglePlace,
  opts: { useLLM: boolean; admin?: ReturnType<typeof createClient> },
) {
  let derived = deriveClassification(place);
  const editorialSummary = place.editorialSummary?.text ?? null;
  const reviewSnippets = (place.reviews ?? [])
    .map((r) => r.text?.text ?? "")
    .filter(Boolean)
    .slice(0, 5);

  // Density-based chain detection: if the deterministic check said
  // "independent" but the same name appears 3+ times elsewhere in the DB,
  // upgrade. This self-corrects for chains we don't have in KNOWN_CHAINS.
  if (opts.admin && derived.chain_type === "independent" && place.displayName?.text) {
    const name = place.displayName.text;
    const { count } = await opts.admin
      .from("restaurants")
      .select("id", { count: "exact", head: true })
      .ilike("name", name)
      .neq("google_place_id", place.id);
    if ((count ?? 0) >= 3) {
      derived = {
        ...derived,
        chain_name: name,
        chain_type: "regional_chain",
        confidence: { ...derived.confidence, chain_type: 0.7 },
      };
    }
  }

  const llmInput: LLMInput = {
    name: place.displayName?.text ?? "Unknown",
    types: place.types ?? [],
    primaryType: place.primaryType ?? null,
    priceLevel: place.priceLevel ? PRICE_LEVEL_MAP[place.priceLevel] ?? null : null,
    userRatingCount: place.userRatingCount ?? null,
    editorialSummary,
    reviewSnippets,
  };
  // Fire the LLM when cuisine is ambiguous OR when there's enough review text
  // to read vibe/occasion — the latter enriches well-classified places too.
  if (opts.useLLM && anthropic && (shouldUseLLM(derived) || shouldEnrichQualitative(llmInput))) {
    try {
      const suggestion = await classifyWithLLM(
        llmInput,
        anthropic.messages.create.bind(anthropic.messages),
      );
      derived = mergeLLMIntoDerivation(derived, suggestion);
    } catch (e) {
      // LLM failures are non-fatal — fall back to deterministic.
      console.error("llm classification failed for", place.id, e);
    }
  }

  const row = googleToRestaurantRow(place, derived);
  return {
    ...row,
    editorial_summary: editorialSummary,
    review_snippets: reviewSnippets.length ? reviewSnippets : null,
    reviews_refreshed_at: opts.useLLM ? new Date().toISOString() : null,
    google_raw: place,
  };
}

// ----- Cost-control helpers ---------------------------------------------

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

// Best-effort push to the founder's device when a budget threshold is crossed.
// Reuses the same Expo endpoint as notify-feed-post. Never throws.
async function sendAlertPush(title: string, body: string) {
  if (!ALERT_PUSH_TOKEN) return;
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ to: ALERT_PUSH_TOKEN, title, body, priority: "high", sound: "default" }),
    });
  } catch (_) { /* alerts are best-effort — never break the request */ }
}

// True when today's billable-call budget is already spent.
async function isTripped(admin: ReturnType<typeof createClient>): Promise<boolean> {
  const { data } = await admin
    .from("google_usage_counter")
    .select("tripped")
    .eq("day", todayUTC())
    .maybeSingle();
  return data?.tripped === true;
}

// Count one billable Google call and fire the 80% / tripped alerts exactly
// once each (the RPC reports which caller crossed the threshold).
async function reserveGoogleCall(admin: ReturnType<typeof createClient>) {
  try {
    const { data } = await admin.rpc("bump_google_usage", {
      p_day: todayUTC(),
      p_cap: GOOGLE_DAILY_CALL_CAP,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
    if (row.crossed_warn) {
      await sendAlertPush(
        "Palate — Google budget at 80%",
        `${row.new_count}/${GOOGLE_DAILY_CALL_CAP} Google Places calls used today.`,
      );
    }
    if (row.crossed_trip) {
      await sendAlertPush(
        "⚠️ Palate kill-switch tripped",
        `Hit ${GOOGLE_DAILY_CALL_CAP} Google calls — serving cached results only until tomorrow (UTC).`,
      );
    }
  } catch (_) { /* metering must never break the request */ }
}

// Telemetry (best-effort): per-day tally of proxy activity by action + source.
async function recordUsage(
  admin: ReturnType<typeof createClient>,
  action: string,
  source: "google" | "cache",
) {
  try {
    await admin.rpc("record_api_usage", { p_day: todayUTC(), p_action: action, p_source: source });
  } catch (_) { /* telemetry must never break the request */ }
}

// Degraded nearby: a bounding-box query on the cached restaurants, used only
// when the Google budget is spent. Less fresh than a live call, but keeps the
// map usable instead of returning nothing.
async function degradedNearby(
  admin: ReturnType<typeof createClient>,
  lat: number,
  lng: number,
  radius: number,
) {
  const dLat = radius / 111000;
  const dLng = radius / ((111000 * Math.cos((lat * Math.PI) / 180)) || 111000);
  const { data } = await admin
    .from("restaurants_resolved")
    .select("*")
    .gte("latitude", lat - dLat).lte("latitude", lat + dLat)
    .gte("longitude", lng - dLng).lte("longitude", lng + dLng)
    .or("recommendation_eligibility.is.null,recommendation_eligibility.gt.0")
    .order("user_rating_count", { ascending: false })
    .limit(NEARBY_MAX_RESULTS);
  return data ?? [];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
