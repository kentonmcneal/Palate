// Palate — Gmail import.
//
// Three actions (POST):
//   action: "connect"    — body: { code, redirect_uri }
//                          Exchanges the OAuth code for tokens, stores them,
//                          and runs an initial scan.
//   action: "scan"       — body: { since_days?: 90 }
//                          Refreshes the access token if needed, scans Gmail
//                          for known restaurant senders, parses each, dedups,
//                          inserts as visits with import_source='gmail'.
//   action: "disconnect" — clears the tokens row + revokes the refresh_token
//                          with Google.
//
// Returns: { connected, email, imported, skipped, error? }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Senders we know how to parse. The query in scanInbox restricts Gmail to
// these so we only fetch what we can use.
const RECEIPT_SENDERS = [
  "no-reply@opentable.com",
  "noreply@opentable.com",
  "info@resy.com",
  "no-reply@resy.com",
  "no-reply@doordash.com",
  "no-reply@order.uber.com",
  "noreply@grubhub.com",
  "no-reply@trycaviar.com",
  "noreply@yelp.com",
  "no-reply@exploretock.com",
  "noreply@sevenrooms.com",
  "messenger@squareup.com",
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "missing auth" }, 401);

    const userClient = createClient(SUPABASE_URL, jwt, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: u } = await userClient.auth.getUser();
    const userId = u.user?.id;
    if (!userId) return json({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const action = body.action as "connect" | "scan" | "disconnect" | undefined;

    if (action === "connect") return await handleConnect(admin, userId, body);
    if (action === "scan")    return await handleScan(admin, userId, body);
    if (action === "disconnect") return await handleDisconnect(admin, userId);
    return json({ error: "unknown action" }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

// ----------------------------------------------------------------------------
// connect — exchange OAuth code for tokens and run initial scan
// ----------------------------------------------------------------------------
async function handleConnect(admin: ReturnType<typeof createClient>, userId: string, body: any) {
  const code = body.code as string | undefined;
  const redirect_uri = body.redirect_uri as string | undefined;
  if (!code || !redirect_uri) return json({ error: "code + redirect_uri required" }, 400);

  // Exchange code for tokens
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    return json({ error: "google_token_exchange_failed", detail: text }, 502);
  }
  const tokens = await tokenResp.json() as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string };

  // Decode the id_token (JWT) to get the user's gmail address — middle segment is base64url JSON
  let email = "";
  if (tokens.id_token) {
    const parts = tokens.id_token.split(".");
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        email = payload.email ?? "";
      } catch { /* ignore */ }
    }
  }

  // Refresh token isn't always returned (only on first connect). If absent,
  // user already had us connected — pull the existing one.
  let refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    const { data: existing } = await admin.from("gmail_tokens").select("refresh_token").eq("user_id", userId).maybeSingle();
    refreshToken = (existing as any)?.refresh_token;
  }
  if (!refreshToken) {
    return json({
      error: "no_refresh_token",
      hint: "User must consent again with prompt=consent to grant offline access",
    }, 400);
  }

  await admin.from("gmail_tokens").upsert({
    user_id: userId,
    refresh_token: refreshToken,
    access_token: tokens.access_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    email,
    updated_at: new Date().toISOString(),
  });

  // Initial scan — last 90 days
  const result = await runScan(admin, userId, 90);
  return json({ connected: true, email, ...result });
}

// ----------------------------------------------------------------------------
// scan — refresh token if expired, fetch new messages, parse + insert
// ----------------------------------------------------------------------------
async function handleScan(admin: ReturnType<typeof createClient>, userId: string, body: any) {
  const sinceDays = (body.since_days as number) ?? 30;
  const result = await runScan(admin, userId, sinceDays);
  return json(result);
}

async function runScan(admin: ReturnType<typeof createClient>, userId: string, sinceDays: number) {
  const accessToken = await getValidAccessToken(admin, userId);
  if (!accessToken) return { error: "not_connected", imported: 0, skipped: 0 };

  // Build the Gmail search query
  const fromClause = RECEIPT_SENDERS.map((s) => `from:${s}`).join(" OR ");
  const sinceClause = `newer_than:${sinceDays}d`;
  const query = `(${fromClause}) ${sinceClause}`;

  // List matching message IDs (paginated)
  const messageIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) {
      return { error: "gmail_list_failed", detail: await r.text(), imported: 0, skipped: 0 };
    }
    const j = await r.json() as { messages?: Array<{ id: string }>; nextPageToken?: string };
    for (const m of (j.messages ?? [])) messageIds.push(m.id);
    pageToken = j.nextPageToken;
    if (messageIds.length >= 500) break; // safety cap
  } while (pageToken);

  // Dedupe against already-imported
  const { data: existing } = await admin
    .from("visits")
    .select("import_external_id")
    .eq("user_id", userId)
    .eq("import_source", "gmail")
    .in("import_external_id", messageIds);
  const existingIds = new Set((existing ?? []).map((r: any) => r.import_external_id));
  const newIds = messageIds.filter((id) => !existingIds.has(id));

  let imported = 0;
  let skipped = 0;
  for (const id of newIds) {
    try {
      const detail = await fetchMessage(accessToken, id);
      const parsed = parseMessage(detail);
      if (!parsed) { skipped++; continue; }
      const ok = await createImportedVisit(admin, userId, id, parsed);
      if (ok) imported++; else skipped++;
    } catch {
      skipped++;
    }
  }

  await admin.from("gmail_tokens").update({
    last_scanned_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);

  return { imported, skipped, total_found: messageIds.length };
}

// ----------------------------------------------------------------------------
// Token helpers
// ----------------------------------------------------------------------------
async function getValidAccessToken(admin: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data: row } = await admin
    .from("gmail_tokens")
    .select("refresh_token, access_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return null;

  const expiresAt = (row as any).expires_at ? new Date((row as any).expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 60_000 && (row as any).access_token) {
    return (row as any).access_token;
  }

  // Refresh
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: (row as any).refresh_token,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) return null;
  const t = await r.json() as { access_token: string; expires_in: number };
  await admin.from("gmail_tokens").update({
    access_token: t.access_token,
    expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  return t.access_token;
}

// ----------------------------------------------------------------------------
// disconnect — revoke + clear
// ----------------------------------------------------------------------------
async function handleDisconnect(admin: ReturnType<typeof createClient>, userId: string) {
  const { data: row } = await admin
    .from("gmail_tokens").select("refresh_token").eq("user_id", userId).maybeSingle();
  if (row && (row as any).refresh_token) {
    // Best-effort revoke; ignore failure
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${(row as any).refresh_token}`, { method: "POST" });
    } catch { /* ignore */ }
  }
  await admin.from("gmail_tokens").delete().eq("user_id", userId);
  return json({ disconnected: true });
}

// ----------------------------------------------------------------------------
// Gmail helpers
// ----------------------------------------------------------------------------
type GmailMessage = {
  id: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    parts?: Array<{ mimeType: string; body?: { data?: string }; parts?: any[] }>;
    body?: { data?: string };
  };
  internalDate?: string;
  snippet?: string;
};

async function fetchMessage(accessToken: string, id: string): Promise<GmailMessage> {
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return await r.json();
}

function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

// Recursively grab the text body — Gmail sometimes nests parts.
function bodyText(msg: GmailMessage): string {
  const out: string[] = [];
  function walk(part: any) {
    if (!part) return;
    if (part.body?.data) {
      try {
        const decoded = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
        out.push(decoded);
      } catch { /* ignore */ }
    }
    if (part.parts) for (const p of part.parts) walk(p);
  }
  walk(msg.payload);
  return out.join("\n");
}

// ----------------------------------------------------------------------------
// Receipt parsing
// ----------------------------------------------------------------------------
type ParsedReceipt = {
  restaurantName: string;
  visitedAt: Date;
  source: "reservation" | "delivery" | "pos";
};

function parseMessage(msg: GmailMessage): ParsedReceipt | null {
  const from = header(msg, "from").toLowerCase();
  const subject = header(msg, "subject");
  const text = bodyText(msg) + " " + (msg.snippet ?? "");
  const internalDate = msg.internalDate ? new Date(parseInt(msg.internalDate)) : new Date();

  // Each parser is best-effort. First successful match wins.
  if (from.includes("opentable.com")) return parseOpenTable(subject, text, internalDate);
  if (from.includes("resy.com"))      return parseResy(subject, text, internalDate);
  if (from.includes("doordash.com"))  return parseDoorDash(subject, text, internalDate);
  if (from.includes("uber.com"))      return parseUberEats(subject, text, internalDate);
  if (from.includes("grubhub.com"))   return parseGrubhub(subject, text, internalDate);
  if (from.includes("trycaviar.com")) return parseCaviar(subject, text, internalDate);
  if (from.includes("yelp.com"))      return parseYelp(subject, text, internalDate);
  if (from.includes("exploretock.com")) return parseTock(subject, text, internalDate);
  if (from.includes("sevenrooms.com")) return parseSevenRooms(subject, text, internalDate);
  if (from.includes("squareup.com"))  return parseSquare(subject, text, internalDate);
  return null;
}

// Parsers — each pulls the restaurant name from the subject or first body line.
// Real-world variation is high; these are starting points that we'll tune
// with logged failures from real users.

function parseOpenTable(subject: string, _text: string, dt: Date): ParsedReceipt | null {
  // "Your reservation at Lilia is confirmed"
  const m = subject.match(/(?:reservation at|reminder:|you're going to)\s+(.+?)(?:\s+is\s+|$)/i);
  if (!m) return null;
  return { restaurantName: m[1].trim(), visitedAt: dt, source: "reservation" };
}
function parseResy(subject: string, _text: string, dt: Date): ParsedReceipt | null {
  // "Your reservation is confirmed at Atomix"
  const m = subject.match(/(?:reservation.*?at|booking.*?at)\s+(.+)/i);
  if (!m) return null;
  return { restaurantName: m[1].trim(), visitedAt: dt, source: "reservation" };
}
function parseDoorDash(subject: string, text: string, dt: Date): ParsedReceipt | null {
  // "Your DoorDash order from Sweetgreen"
  const m = subject.match(/order from\s+(.+?)(?:\s+\(|$)/i) || text.match(/Order from\s+(.+?)\n/i);
  if (!m) return null;
  return { restaurantName: m[1].trim(), visitedAt: dt, source: "delivery" };
}
function parseUberEats(subject: string, _text: string, dt: Date): ParsedReceipt | null {
  // "Your Tuesday lunch with Joe's Pizza" or "Receipt from Joe's Pizza"
  const m = subject.match(/(?:with|from)\s+(.+?)(?:\s*\||\s*-|$)/i);
  if (!m) return null;
  return { restaurantName: m[1].trim(), visitedAt: dt, source: "delivery" };
}
function parseGrubhub(subject: string, text: string, dt: Date): ParsedReceipt | null {
  const m = subject.match(/(?:order from|receipt from)\s+(.+)/i) || text.match(/Order from\s+(.+?)\n/i);
  if (!m) return null;
  return { restaurantName: m[1].trim(), visitedAt: dt, source: "delivery" };
}
function parseCaviar(subject: string, _text: string, dt: Date): ParsedReceipt | null {
  const m = subject.match(/(?:from|receipt:)\s+(.+)/i);
  if (!m) return null;
  return { restaurantName: m[1].trim(), visitedAt: dt, source: "delivery" };
}
function parseYelp(subject: string, _text: string, dt: Date): ParsedReceipt | null {
  // "Reservation confirmed at Cote"
  const m = subject.match(/(?:reservation.*?at|booking.*?at)\s+(.+)/i);
  if (!m) return null;
  return { restaurantName: m[1].trim(), visitedAt: dt, source: "reservation" };
}
function parseTock(subject: string, _text: string, dt: Date): ParsedReceipt | null {
  const m = subject.match(/(?:reservation at|booking at)\s+(.+)/i);
  if (!m) return null;
  return { restaurantName: m[1].trim(), visitedAt: dt, source: "reservation" };
}
function parseSevenRooms(subject: string, _text: string, dt: Date): ParsedReceipt | null {
  const m = subject.match(/(?:at|reservation:)\s+(.+)/i);
  if (!m) return null;
  return { restaurantName: m[1].trim(), visitedAt: dt, source: "reservation" };
}
function parseSquare(subject: string, text: string, dt: Date): ParsedReceipt | null {
  // "Receipt from Joe's Pizza" / body usually leads with the merchant name
  const m = subject.match(/receipt from\s+(.+)/i) || text.match(/^([A-Z][^\n]{2,40})\n/m);
  if (!m) return null;
  return { restaurantName: m[1].trim(), visitedAt: dt, source: "pos" };
}

// ----------------------------------------------------------------------------
// Visit creation — Google Places lookup + insert
// ----------------------------------------------------------------------------
async function createImportedVisit(
  admin: ReturnType<typeof createClient>, userId: string, messageId: string, parsed: ParsedReceipt,
): Promise<boolean> {
  // Resolve restaurant via Google Places text search
  const placeId = await placeIdForName(parsed.restaurantName);
  if (!placeId) return false;

  // Ensure the restaurant exists in our cache (places-proxy upserts)
  const { data: rest } = await admin
    .from("restaurants").select("id").eq("google_place_id", placeId).maybeSingle();
  if (!rest) return false;

  const { error } = await admin.from("visits").insert({
    user_id: userId,
    restaurant_id: (rest as any).id,
    visited_at: parsed.visitedAt.toISOString(),
    meal_type: mealTypeFor(parsed.visitedAt),
    detection_source: "manual",
    confirmed_by_user: false,
    notes: null,
    import_source: "gmail",
    import_external_id: messageId,
  });
  return !error;
}

async function placeIdForName(name: string): Promise<string | null> {
  try {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "places.id",
      },
      body: JSON.stringify({ textQuery: name, includedType: "restaurant", maxResultCount: 1 }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.places?.[0]?.id ?? null;
  } catch { return null; }
}

function mealTypeFor(date: Date): string {
  const h = date.getHours();
  if (h >= 5 && h < 11) return "breakfast";
  if (h >= 11 && h < 15) return "lunch";
  if (h >= 17 && h < 22) return "dinner";
  return "snack";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
