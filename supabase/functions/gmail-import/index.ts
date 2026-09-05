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
import {
  RECEIPT_SENDERS as SHARED_SENDERS,
  parseReceipt,
  nameKey,
  type ParsedReceipt as SharedReceipt,
} from "../_shared/receipt-parser.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// iOS OAuth client ID — same one the mobile app uses. PKCE means no
// client_secret is needed for the token exchange (Google rejects secrets
// for native client IDs anyway).
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_IOS_CLIENT_ID")!;
const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY")!;
// Shared secret a scheduled job must send (x-cron-secret) to run scan_all.
// Same mechanism as featured-lists-refresh (migration 0038).
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Senders we know how to parse. The query in scanInbox restricts Gmail to
// these so we only fetch what we can use.

/** Domain of a `From:` header, or null when it does not look like one. */
export function senderDomain(from: string | null | undefined): string | null {
  const m = /<?([^<>\s@]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})>?/.exec(from ?? "");
  if (!m) return null;
  const host = m[2].toLowerCase();
  // Collapse the sending subdomain: em.opentable.com and mgs.opentable.com are
  // one platform, and three rows for one answer is a worse answer.
  const parts = host.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : host;
}

async function recordSenderMiss(admin: any, from: string | null | undefined) {
  const domain = senderDomain(from);
  if (!domain) return;
  try {
    await admin.rpc("record_sender_miss", { p_domain: domain });
  } catch (_) { /* telemetry must never break an import */ }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action as "connect" | "scan" | "preview" | "commit" | "disconnect" | "scan_all" | undefined;

    // scan_all is the ONLY action without a user session — a scheduler has no
    // user to be. It is gated on the shared cron secret instead, and fails
    // closed when the secret is unset so it can never run open by accident.
    if (action === "scan_all") {
      if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
        return json({ error: "unauthorized" }, 401);
      }
      return await handleScanAll(createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY), body);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "missing auth" }, 401);

    const userClient = createClient(SUPABASE_URL, jwt, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: u } = await userClient.auth.getUser();
    const userId = u.user?.id;
    if (!userId) return json({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    if (action === "connect") return await handleConnect(admin, userId, body);
    if (action === "scan")    return await handleScan(admin, userId, body);
    if (action === "preview") return await handlePreview(admin, userId, body);
    if (action === "commit")  return await handleCommit(admin, userId, body);
    if (action === "disconnect") return await handleDisconnect(admin, userId);
    return json({ error: "unknown action" }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});


// ----------------------------------------------------------------------------
// preview — what an import WOULD do, without doing any of it
// ----------------------------------------------------------------------------
// The whole point: email import is the only path in the product with a real
// per-user marginal cost, and the honest way to price it is to count the
// lookups an import would make WITHOUT making them.
//
// Runs the identical Gmail query and the identical parser, then resolves names
// against the local restaurants table exactly as placeIdForName() does — and
// stops there. Zero Google calls. Zero writes. The unresolved names come back
// so the parser's blind spots are visible rather than inferred.
async function handlePreview(
  admin: ReturnType<typeof createClient>,
  userId: string,
  body: any,
) {
  const sinceDays = Math.min(Number(body.since_days) || 90, 90);
  const accessToken = await getValidAccessToken(admin, userId);
  if (!accessToken) return json({ error: "not_connected" }, 400);

  const fromClause = SHARED_SENDERS.map((s) => `from:${s}`).join(" OR ");
  const query = `(${fromClause}) newer_than:${sinceDays}d`;

  const messageIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return json({ error: "gmail_list_failed", detail: await r.text() }, 502);
    const j = await r.json() as { messages?: Array<{ id: string }>; nextPageToken?: string };
    for (const m of (j.messages ?? [])) messageIds.push(m.id);
    pageToken = j.nextPageToken;
    if (messageIds.length >= 500) break;
  } while (pageToken);

  // Already-imported messages cost nothing and should not inflate the estimate.
  const { data: existing } = await admin
    .from("visits")
    .select("import_external_id")
    .eq("user_id", userId)
    .eq("import_source", "gmail")
    .in("import_external_id", messageIds);
  const already = new Set((existing ?? []).map((r: any) => r.import_external_id));
  const fresh = messageIds.filter((id) => !already.has(id));

  let parsedCount = 0;
  let unparseable = 0;
  const byName = new Map<string, { name: string; count: number }>();
  const receipts: Array<{
    message_id: string; name: string; visited_at: string; source: string;
  }> = [];

  for (const id of fresh) {
    let detail;
    try {
      detail = await fetchMessage(accessToken, id);
    } catch {
      unparseable++;
      continue;
    }
    const parsed = parseReceipt({
      from: header(detail, "from"),
      subject: header(detail, "subject"),
      text: bodyText(detail) + " " + (detail.snippet ?? ""),
      internalDate: detail.internalDate ? new Date(parseInt(detail.internalDate)) : new Date(),
    });
    if (!parsed) { unparseable++; continue; }
    parsedCount++;
    receipts.push({
      message_id: id,
      name: parsed.restaurantName,
      visited_at: parsed.visitedAt.toISOString(),
      source: parsed.source,
    });
    const key = nameKey(parsed.restaurantName);
    const seen = byName.get(key);
    if (seen) seen.count++;
    else byName.set(key, { name: parsed.restaurantName, count: 1 });
  }

  // Resolve against the local table the same way the real import would.
  const known: string[] = [];
  const unknown: string[] = [];
  for (const { name } of byName.values()) {
    const { data: hit } = await admin
      .from("restaurants")
      .select("google_place_id")
      .ilike("name", name)
      .limit(1)
      .maybeSingle();
    if ((hit as any)?.google_place_id) known.push(name);
    else unknown.push(name);
  }

  return json({
    since_days: sinceDays,
    messages_matched: messageIds.length,
    already_imported: messageIds.length - fresh.length,
    receipts_parsed: parsedCount,
    unparseable,
    unique_restaurants: byName.size,
    resolved_locally: known.length,
    // The number this whole exercise exists to produce.
    would_cost_lookups: unknown.length,
    unresolved_names: unknown.slice(0, 50),
    // The parsed receipts themselves, so the app can show them for review
    // before anything is written or looked up.
    receipts,
  });
}


// ----------------------------------------------------------------------------
// commit — write the receipts the user actually confirmed
// ----------------------------------------------------------------------------
// The import used to write visits straight out of the scan. It should propose
// them: a parser bug that reaches the taste graph is invisible to the person it
// happens to, and every recommendation afterwards is computed from it.
//
// Committing only confirmed message ids also makes the COST proportional to
// what someone accepts rather than to what we parsed. A person who ticks three
// of twenty receipts pays for three lookups.
async function handleCommit(
  admin: ReturnType<typeof createClient>,
  userId: string,
  body: any,
) {
  const ids: string[] = Array.isArray(body.message_ids) ? body.message_ids.slice(0, 200) : [];
  if (ids.length === 0) return json({ imported: 0, skipped: 0 });

  const accessToken = await getValidAccessToken(admin, userId);
  if (!accessToken) return json({ error: "not_connected" }, 400);

  // Never re-import something already written, even if the client sends it.
  const { data: existing } = await admin
    .from("visits")
    .select("import_external_id")
    .eq("user_id", userId)
    .eq("import_source", "gmail")
    .in("import_external_id", ids);
  const already = new Set((existing ?? []).map((r: any) => r.import_external_id));

  let imported = 0;
  let skipped = 0;
  for (const id of ids) {
    if (already.has(id)) { skipped++; continue; }
    try {
      const detail = await fetchMessage(accessToken, id);
      // Re-parsed server-side rather than trusting the name the client sent
      // back. A client is not a source of truth about what an email said.
      const parsed = parseReceipt({
        from: header(detail, "from"),
        subject: header(detail, "subject"),
        text: bodyText(detail) + " " + (detail.snippet ?? ""),
        internalDate: detail.internalDate ? new Date(parseInt(detail.internalDate)) : new Date(),
      });
      if (!parsed) {
        // Record which PLATFORM we could not read, so "are there other emails
        // to add?" is answered from evidence instead of guessed at. Domain
        // only — no address, no subject, no user id. Best-effort: telemetry
        // must never cost somebody an import.
        void recordSenderMiss(admin, header(detail, "from"));
        skipped++;
        continue;
      }
      const ok = await createImportedVisit(admin, userId, id, parsed);
      if (ok) imported++; else skipped++;
    } catch {
      skipped++;
    }
  }

  await admin.from("gmail_tokens")
    .update({ last_scanned_at: new Date().toISOString() })
    .eq("user_id", userId);

  return json({ imported, skipped });
}

// ----------------------------------------------------------------------------
// connect — exchange OAuth code for tokens and run initial scan
// ----------------------------------------------------------------------------
async function handleConnect(admin: ReturnType<typeof createClient>, userId: string, body: any) {
  const code = body.code as string | undefined;
  const redirect_uri = body.redirect_uri as string | undefined;
  const code_verifier = body.code_verifier as string | undefined;
  if (!code || !redirect_uri || !code_verifier) {
    return json({ error: "code + redirect_uri + code_verifier required" }, 400);
  }

  // Exchange code for tokens — PKCE flow, no client_secret needed.
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      code_verifier,
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
    // Google omits refresh_token on a re-consent it considers redundant. Fall
    // back to the stored one — decrypted via RPC, since the column is null by
    // design after migration 0066.
    const { data: stored } = await admin.rpc("read_gmail_refresh", { p_user: userId });
    refreshToken = (stored as string | null) ?? undefined;
  }
  if (!refreshToken) {
    return json({
      error: "no_refresh_token",
      hint: "User must consent again with prompt=consent to grant offline access",
    }, 400);
  }

  // Encrypted by the database, keyed from Vault. The plaintext refresh token
  // exists only in this request's memory and is never written to a column.
  const { error: storeErr } = await admin.rpc("store_gmail_token", {
    p_user: userId,
    p_refresh: refreshToken,
    p_access: tokens.access_token,
    p_expires: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    p_email: email,
  });
  if (storeErr) return json({ error: "token_store_failed", detail: storeErr.message }, 500);

  // Connecting does NOT import. It used to run a 90-day scan right here,
  // which wrote visits and spent a Google lookup per unknown restaurant before
  // the user had seen a single thing we found. Two problems with that: a parser
  // bug reached the taste graph silently, and the cost was incurred on connect
  // rather than on consent.
  //
  // The flow is now connect -> preview (free) -> review -> commit. The client
  // calls preview next.
  return json({ connected: true, email });
}

// ----------------------------------------------------------------------------
// scan — refresh token if expired, fetch new messages, parse + insert
// ----------------------------------------------------------------------------
/**
 * Scan every connected inbox. Not scheduled — the cron migration is
 * deliberately absent, because turning this on is recurring Google spend and
 * that is the operator's call, not a deploy artifact.
 *
 * Users are processed sequentially and a failure is recorded rather than
 * thrown: one revoked token must not abort everyone else's import. The daily
 * Google cap is shared, so a fan-out that exhausts the budget degrades to
 * "no new place lookups" instead of an unbounded bill.
 */
// Ceiling on how many inboxes one scheduled run will touch. Two reasons, and
// the daily Google cap covers neither:
//   1. An edge function has a wall-clock limit. Scanning every connected inbox
//      in one pass gets slower as the user base grows until the run is killed
//      part-way through, silently and always at the same point in the list.
//   2. The daily Google budget is shared with the live app. A cron that spends
//      it all before breakfast leaves real users staring at cached results.
// Users are taken least-recently-scanned first, so a capped run rotates through
// everyone across successive days instead of starving the tail of the table.
const MAX_USERS_PER_RUN = 200;

async function handleScanAll(admin: ReturnType<typeof createClient>, body: any) {
  const sinceDays = Math.min(Number(body.sinceDays ?? 3), 30);
  const limit = Math.min(Number(body.maxUsers ?? MAX_USERS_PER_RUN), MAX_USERS_PER_RUN);
  const { data: rows, error } = await admin
    .from("gmail_tokens")
    .select("user_id")
    // nullsFirst: a never-scanned account is the most urgent, not the least.
    .order("last_scanned_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) return json({ error: error.message }, 500);

  const users = (rows ?? []) as Array<{ user_id: string }>;
  let imported = 0;
  let failed = 0;
  const perUser: Array<{ user_id: string; imported?: number; error?: string }> = [];

  for (const { user_id } of users) {
    if (await budgetSpent(admin)) {
      perUser.push({ user_id, error: "google_budget_spent" });
      failed++;
      continue;
    }
    try {
      const result = await runScan(admin, user_id, sinceDays);
      imported += result.imported ?? 0;
      perUser.push({ user_id, imported: result.imported ?? 0 });
    } catch (e) {
      failed++;
      perUser.push({ user_id, error: String(e) });
    }
  }

  // perUser is capped in the response: a cron does not read it, and an
  // unbounded array grows with the user base for no benefit.
  return json({
    scanned: users.length,
    imported,
    failed,
    truncated: users.length >= limit,
    perUser: perUser.slice(0, 25),
  });
}

async function handleScan(admin: ReturnType<typeof createClient>, userId: string, body: any) {
  const sinceDays = (body.since_days as number) ?? 30;
  const result = await runScan(admin, userId, sinceDays);
  return json(result);
}

async function runScan(admin: ReturnType<typeof createClient>, userId: string, sinceDays: number) {
  const accessToken = await getValidAccessToken(admin, userId);
  if (!accessToken) return { error: "not_connected", imported: 0, skipped: 0 };

  // Build the Gmail search query
  const fromClause = SHARED_SENDERS.map((s) => `from:${s}`).join(" OR ");
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
      const parsed = parseReceipt({
        from: header(detail, "from"),
        subject: header(detail, "subject"),
        text: bodyText(detail) + " " + (detail.snippet ?? ""),
        internalDate: detail.internalDate ? new Date(parseInt(detail.internalDate)) : new Date(),
      });
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
    .select("access_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return null;

  const expiresAt = (row as any).expires_at ? new Date((row as any).expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 60_000 && (row as any).access_token) {
    return (row as any).access_token;
  }

  // The refresh token is encrypted at rest (migration 0066) and the key lives
  // in Vault. It is decrypted inside Postgres and never selected as a column,
  // so a stray select * cannot leak somebody's mailbox access.
  const { data: refreshToken } = await admin.rpc("read_gmail_refresh", { p_user: userId });
  if (!refreshToken) return null;

  // Refresh — native client + PKCE, no client_secret.
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken as string,
      client_id: GOOGLE_CLIENT_ID,
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
  // Decrypted via RPC — the column is null by design after 0066, and reading it
  // directly would silently skip the revoke, leaving Google-side access alive
  // after the user asked us to disconnect. That is the worst possible way for
  // this to fail: quietly, and in the direction of keeping access.
  const { data: refreshToken } = await admin.rpc("read_gmail_refresh", { p_user: userId });
  if (refreshToken) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken as string)}`, { method: "POST" });
    } catch { /* best effort — the row is deleted either way */ }
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
// Visit creation — Google Places lookup + insert
// ----------------------------------------------------------------------------
async function createImportedVisit(
  admin: ReturnType<typeof createClient>, userId: string, messageId: string, parsed: SharedReceipt,
): Promise<boolean> {
  // Resolve restaurant via Google Places text search
  const placeId = await placeIdForName(admin, parsed.restaurantName);
  if (!placeId) return false;

  // A place we have never seen: insert the minimal row (id + the name on
  // the receipt) so the visit records now. The catalogue fills the rest the
  // first time anyone opens the place through places-proxy. This used to
  // return false here, which dropped the visit after paying for the lookup.
  // Found by the code review.
  let { data: rest } = await admin
    .from("restaurants").select("id").eq("google_place_id", placeId).maybeSingle();
  if (!rest) {
    const { data: made } = await admin
      .from("restaurants")
      .upsert({ google_place_id: placeId, name: parsed.restaurantName }, { onConflict: "google_place_id" })
      .select("id")
      .maybeSingle();
    rest = made;
  }
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

// ---------------------------------------------------------------------------
// Google Places metering
// ---------------------------------------------------------------------------
// This function called Google uncapped while places-proxy has been metered and
// kill-switched since migration 0033. That was survivable while the only
// trigger was a human tapping "Rescan"; it is not once a scheduled scan can
// fan out across every connected inbox. Same counter, same daily cap, same
// kill switch — one budget for the whole project, not one per caller.

const GOOGLE_DAILY_CALL_CAP = Number(Deno.env.get("GOOGLE_DAILY_CALL_CAP") ?? 2000);

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

async function budgetSpent(admin: ReturnType<typeof createClient>): Promise<boolean> {
  try {
    const { data } = await admin
      .from("google_usage_counter")
      .select("tripped")
      .eq("day", todayUTC())
      .maybeSingle();
    return (data as any)?.tripped === true;
  } catch {
    // Fail OPEN on a metering read error: a database blip should not silently
    // stop importing people's receipts. The counter below still records the
    // call, so the cap re-asserts itself on the next request.
    return false;
  }
}

async function meterGoogleCall(admin: ReturnType<typeof createClient>): Promise<void> {
  try {
    await admin.rpc("bump_google_usage", { p_day: todayUTC(), p_cap: GOOGLE_DAILY_CALL_CAP });
    await admin.rpc("record_api_usage", { p_day: todayUTC(), p_action: "gmail_place_lookup", p_source: "google" });
  } catch {
    /* metering must never break the import */
  }
}

async function placeIdForName(
  admin: ReturnType<typeof createClient>,
  name: string,
): Promise<string | null> {
  // Cheap first: a receipt for a restaurant we already know needs no Google
  // call at all. Most repeat imports hit this.
  try {
    const { data: known } = await admin
      .from("restaurants")
      .select("google_place_id")
      .ilike("name", name)
      .limit(1)
      .maybeSingle();
    if ((known as any)?.google_place_id) return (known as any).google_place_id;
  } catch { /* fall through to the metered lookup */ }

  if (await budgetSpent(admin)) return null;
  await meterGoogleCall(admin);

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
