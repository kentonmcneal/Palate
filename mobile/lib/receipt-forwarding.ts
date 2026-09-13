// ============================================================================
// receipt-forwarding.ts — receipts without the mailbox.
// ----------------------------------------------------------------------------
// Replaces the Gmail OAuth import (see gmail-gate.ts for why it was withdrawn).
// The user forwards a confirmation to receipts+<token>@<domain>; a Cloudflare
// Email Worker hands it to the receipt-ingest function; the SAME parser the
// Gmail path used turns it into a pending row here.
//
// The token is the identity. It is minted server-side by my_receipt_token() and
// the client cannot choose or write one — a From header is trivially forged,
// so it is never what decides whose account a receipt lands in.
//
// Accepting is free by design. A pending receipt carries a NAME, and turning a
// name into a place is a paid Google lookup, so accept resolves against the
// local catalogue only and hands anything it cannot find to the search screen
// the user already drives by hand. Nothing in this file can spend money.
// ============================================================================
import { supabase } from "./supabase";
import { saveVisit } from "./visits";

/**
 * The domain receipts are forwarded to.
 *
 * your-palate.com, not palate.app, and deliberately: palate.app has never
 * resolved (SHIP_CHECKLIST, FINISH_LINE), while your-palate.com already carries
 * live mail as the Resend sender for login OTPs. Shipping an address on a
 * domain with no MX record would hand every user a bounce, which is a worse
 * first impression than the Google warning this replaced.
 *
 * Note for whoever moves this to palate.app later: Cloudflare Email Routing
 * writes MX records, which govern RECEIVING. Resend's SPF/DKIM govern SENDING
 * and are untouched by it — the OTP path does not break. Change this one
 * constant, add the Route in Cloudflare, and existing tokens keep working
 * because the token is the identity, not the domain.
 */
export const RECEIPT_DOMAIN = "your-palate.com";

export type PendingReceipt = {
  id: string;
  restaurantName: string;
  visitedAt: string;
  source: string;
  senderDomain: string | null;
  subject: string | null;
};

/** The address to forward to. Mints the token on first call. */
export async function forwardingAddress(rotate = false): Promise<string> {
  const { data, error } = await supabase.rpc("my_receipt_token", { p_rotate: rotate });
  if (error) throw error;
  return `receipts+${data}@${RECEIPT_DOMAIN}`;
}

export async function pendingReceipts(limit = 50): Promise<PendingReceipt[]> {
  const { data, error } = await supabase
    .from("email_receipts")
    .select("id, restaurant_name, visited_at, source, sender_domain, subject")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    restaurantName: r.restaurant_name,
    visitedAt: r.visited_at,
    source: r.source,
    senderDomain: r.sender_domain ?? null,
    subject: r.subject ?? null,
  }));
}

/**
 * The local catalogue only — no Google call, no cost. Returns null when the
 * name is not already known, which is the caller's signal to hand the person
 * to search rather than to spend on their behalf.
 */
async function localPlaceIdFor(name: string): Promise<string | null> {
  const { data } = await supabase
    .from("restaurants")
    .select("google_place_id, name")
    .ilike("name", name)
    .limit(1);
  if (data?.length) return data[0].google_place_id as string;

  // Second pass without punctuation: "Joe's Pizza" vs "Joes Pizza" is the same
  // restaurant and the catalogue is not consistent about the apostrophe.
  const loose = name.replace(/['’]/g, "").trim();
  if (loose === name) return null;
  const { data: d2 } = await supabase
    .from("restaurants")
    .select("google_place_id")
    .ilike("name", loose)
    .limit(1);
  return d2?.length ? (d2[0].google_place_id as string) : null;
}

export type AcceptResult =
  | { ok: true; visitId: string }
  | { ok: false; reason: "needs_lookup"; name: string };

export async function acceptReceipt(r: PendingReceipt): Promise<AcceptResult> {
  const placeId = await localPlaceIdFor(r.restaurantName);
  if (!placeId) return { ok: false, reason: "needs_lookup", name: r.restaurantName };

  const saved = await saveVisit({
    googlePlaceId: placeId,
    visitedAt: new Date(r.visitedAt),
    source: "auto",
  });
  // SaveVisitResult IS the visit row (plus isFirstVisit/totalVisits), so the
  // id is on it directly — no optional-chain guesswork.
  const visitId = saved.id;

  const { error } = await supabase
    .from("email_receipts")
    .update({ status: "accepted", visit_id: visitId })
    .eq("id", r.id);
  if (error) throw error;
  return { ok: true, visitId };
}

export async function rejectReceipt(id: string): Promise<void> {
  const { error } = await supabase
    .from("email_receipts")
    .update({ status: "rejected" })
    .eq("id", id);
  if (error) throw error;
}
