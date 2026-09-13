// ============================================================================
// receipt-ingest — a forwarded confirmation becomes a pending visit.
// ----------------------------------------------------------------------------
// Called by the Cloudflare Email Worker (infra/cloudflare/receipt-router.js),
// never by a phone. The worker receives mail at receipts+<token>@<domain>,
// flattens it to JSON, and posts it here with the shared secret.
//
// Identity is the TOKEN in the address, never the From header. Anyone can put
// anybody's address in a From line; nobody can guess 24 hex characters. The
// From header is used for exactly one thing — deciding which parser to run —
// and it is not trusted for anything else.
//
// Two shapes of forwarded mail, and both have to work:
//
//   A Gmail FILTER forward resends the original nearly intact, so the From
//   header is still OpenTable/DoorDash and the parser matches straight away.
//
//   A hand "Forward" rewrites From to the person forwarding it and buries the
//   original in the body under "---------- Forwarded message ---------". So
//   when the header does not match a known sender, we look for the original
//   From inside the text before giving up. Without this, the one-off forward
//   somebody tries first — the one that decides whether they bother setting up
//   the filter — would silently do nothing.
//
// Nothing here writes a visit. It writes a PENDING row the person reviews.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseReceipt, senderDomain, RECEIPT_SENDERS } from "../_shared/receipt-parser.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INGEST_SECRET = Deno.env.get("RECEIPT_INGEST_SECRET") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The token from receipts+<token>@domain. Returns null for a bare address with
 * no plus-tag, which is a catch-all hit rather than somebody's inbox.
 */
export function tokenFromAddress(to: string | null | undefined): string | null {
  const m = /<?([^<>\s@]+)@/.exec(to ?? "");
  if (!m) return null;
  const local = m[1];
  const plus = local.indexOf("+");
  if (plus < 0) return null;
  const tag = local.slice(plus + 1).trim().toLowerCase();
  return /^[a-f0-9]{16,64}$/.test(tag) ? tag : null;
}

/** Does this From belong to a platform we know how to parse? */
function isKnownSender(from: string): boolean {
  const f = (from ?? "").toLowerCase();
  return RECEIPT_SENDERS.some((d) => f.includes(d));
}

/**
 * The From of the ORIGINAL message. Prefers the header; falls back to the first
 * `From:` line inside a forwarded block. Capped at the first 4000 characters:
 * the original header sits at the top of a forward, and scanning a whole
 * marketing email for an address is how you find the wrong one.
 *
 * The condition here is KNOWN SENDER, not merely "parses as an address" — and
 * the difference is the entire feature. A hand forward arrives From the person
 * forwarding it, and `someone@gmail.com` is a perfectly well-formed address, so
 * a has-a-domain test accepts it, never opens the body, and the forward
 * silently does nothing. Caught by firing a real hand-forward at the deployed
 * function rather than by reading this back to myself.
 */
export function originalSender(headerFrom: string, text: string): string {
  if (isKnownSender(headerFrom)) return headerFrom;
  const head = (text ?? "").slice(0, 4000);
  const m = /^\s*(?:>\s*)?From:\s*(.+)$/im.exec(head);
  if (m && isKnownSender(m[1])) return m[1].trim();
  return m ? m[1].trim() : headerFrom;
}

/**
 * Stable across the same message arriving twice — once by hand, once via the
 * filter the person set up afterwards. Deliberately does NOT include the
 * subject: a forward prefixes "Fwd:", so keying on it would make the hand
 * forward and the filtered copy two different receipts, which is the exact
 * duplicate this is here to stop.
 */
export function dedupeKey(domain: string | null, name: string, at: Date): string {
  const day = at.toISOString().slice(0, 10);
  const n = name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return `${domain ?? "unknown"}|${n}|${day}`;
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Fails CLOSED. An unset secret must never mean "accept everything" — this
  // endpoint writes into strangers' accounts.
  if (!INGEST_SECRET) return json({ error: "ingest_not_configured" }, 503);
  if (req.headers.get("x-ingest-secret") !== INGEST_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  const token = tokenFromAddress(body.to);
  if (!token) return json({ error: "no_token_in_address", to: String(body.to ?? "") }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: owner, error: ownerErr } = await admin
    .from("receipt_ingest_tokens")
    .select("user_id")
    .eq("token", token)
    .maybeSingle();
  if (ownerErr) return json({ error: "lookup_failed", detail: ownerErr.message }, 500);
  // Deliberately the same refusal as a malformed token: a distinguishable
  // "valid token, no such user" turns this into an oracle for guessing them.
  if (!owner) return json({ error: "unknown_token" }, 404);

  const from = originalSender(String(body.from ?? ""), String(body.text ?? ""));
  const domain = senderDomain(from);
  const when = body.date ? new Date(body.date) : new Date();
  const at = Number.isNaN(when.getTime()) ? new Date() : when;

  const parsed = parseReceipt({
    from,
    subject: String(body.subject ?? ""),
    text: String(body.text ?? ""),
    internalDate: at,
  });

  if (!parsed) {
    // Which platform we could not read is the only useful thing about a miss,
    // and it is the same telemetry the Gmail path records.
    if (domain) {
      try { await admin.rpc("record_sender_miss", { p_domain: domain }); } catch (_) { /* never break ingest */ }
    }
    return json({ ok: true, parsed: false, sender_domain: domain }, 200);
  }

  const key = dedupeKey(domain, parsed.restaurantName, parsed.visitedAt);
  const { error: insErr } = await admin.from("email_receipts").insert({
    user_id: owner.user_id,
    sender_domain: domain,
    subject: String(body.subject ?? "").slice(0, 300),
    restaurant_name: parsed.restaurantName,
    visited_at: parsed.visitedAt.toISOString(),
    source: parsed.source,
    dedupe_key: key,
  });

  // 23505 is the dedupe index doing its job, which is a success, not a failure.
  if (insErr && (insErr as any).code !== "23505") {
    return json({ error: "insert_failed", detail: insErr.message }, 500);
  }

  return json({
    ok: true,
    parsed: true,
    duplicate: Boolean(insErr),
    restaurant: parsed.restaurantName,
    sender_domain: domain,
  }, 200);
});
