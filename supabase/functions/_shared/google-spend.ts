// ============================================================================
// google-spend — the ONE way to make a paid Google Places call.
// ----------------------------------------------------------------------------
// Why this module exists, in one incident:
//
// The reviews backfill billed $300 in eight days and nothing said a word. Two
// separate failures, both structural:
//
//   1. THE BUDGET WAS DENOMINATED IN CALLS. GOOGLE_DAILY_CALL_CAP was 1500/day,
//      which is roughly $0/day if the calls are Essentials and $37.50/day if
//      they are Enterprise + Atmosphere. Switching a field mask is a PRICE
//      CHANGE, and a call counter cannot see one. 0153 already got this right
//      for the LLM ("a ceiling measured in dollars, not calls"); the Google
//      side, 90% of the bill, did not.
//
//   2. THE ALARM WAS SWALLOWED BY THE SPENDER. bump_google_usage reports
//      crossed_warn / crossed_trip exactly ONCE a day, to whichever caller
//      crosses the line. places-proxy read those flags and pushed an alert;
//      featured-lists-refresh and reclassify called the same RPC and threw the
//      result away. So the nightly backfill crossed 80%, then the cap, ate both
//      one-shot flags at 2am, and places-proxy could never fire them either.
//      Eight nights, zero notifications.
//
// Hence: guard, reserve, fetch and alert are a SINGLE call here. A new
// caller cannot be silent, cannot forget to be metered, and cannot be mispriced
// without naming a SKU. There should be no `fetch` to googleapis.com anywhere
// else in supabase/functions — gmail-import excepted, and only because its one
// call is the free IDs-Only SKU (it says so, and records `google_free`).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Which price a call is billed at. Chosen by the FIELD MASK, not the endpoint:
 *  the same Place Details URL is cheap or expensive depending on what you ask
 *  for. Name the SKU next to the mask and the two cannot drift apart. */
export type GoogleSku =
  | "details_enterprise_atmosphere" // reviews, editorialSummary, serves*/goodFor*
  | "details_enterprise"                   // structural details: hours, rating, price
  | "search_text_enterprise"               // searchText with rating/hours/priceLevel
  | "search_nearby_enterprise"             // searchNearby with rating/hours/priceLevel
  | "ids_only";                     // field mask of ids alone — free

/** Conservative global first-paid-tier list rates, checked 2026-09-29.
 * https://developers.google.com/maps/billing-and-pricing/pricing
 * https://developers.google.com/maps/documentation/places/web-service/data-fields
 * Ratings, priceLevel and opening hours require Enterprise, not Pro. No free
 * monthly allowance, volume discount or account-specific credit is assumed.
 * This is a reservation estimate, not verified invoice data. */
export const SKU_MICROS: Record<GoogleSku, number> = {
  details_enterprise_atmosphere: 25_000,
  details_enterprise: 20_000,
  search_text_enterprise: 35_000,
  search_nearby_enterprise: 35_000,
  ids_only: 0,
};

/** Unknown SKUs cannot authorize a request by guessing a price. */
export const skuMicros = (sku: GoogleSku): number =>
  Object.prototype.hasOwnProperty.call(SKU_MICROS, sku) ? SKU_MICROS[sku] : NaN;

/** The daily ceiling, in dollars. Tune with GOOGLE_DAILY_BUDGET_USD.
 *
 *  $5/day (~$150/month) against the $37.50/day (~$1,140/month) the old
 *  1500-call cap permitted once the mask went rich. What $5 actually buys:
 *
 *      ~142 search calls        (search_*_enterprise, $0.035)
 *      250 structural details   (details_enterprise, $0.020)
 *      ~200 review details      (atmosphere,    $0.025)
 *
 *  This default is an operational ceiling, not permission to spend in tests.
 *  Per-user limits are separate and do not establish a fleet-wide guarantee.
 *  Alert delivery is best effort and has not been verified live. */
const DAILY_BUDGET_USD = Number(Deno.env.get("GOOGLE_DAILY_BUDGET_USD") ?? "5.00");
export const dailyBudgetMicros = (): number => {
  const micros = Math.round(DAILY_BUDGET_USD * 1_000_000);
  // Invalid, negative, overflowing, or sub-micro-dollar settings disable spend.
  // Never let NaN turn a comparison against the ceiling into an open gate.
  return Number.isSafeInteger(micros) && micros > 0 ? micros : 0;
};

const ALERT_PUSH_TOKEN = Deno.env.get("ALERT_PUSH_TOKEN") ?? "";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const todayUTC = () => new Date().toISOString().slice(0, 10);
const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

/** Best-effort push to the founder's device. Never throws. */
async function alertPush(title: string, body: string): Promise<void> {
  if (!ALERT_PUSH_TOKEN) {
    console.error(`google-spend: ALERT_PUSH_TOKEN unset, alert dropped: ${title} — ${body}`);
    return;
  }
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ to: ALERT_PUSH_TOKEN, title, body, priority: "high", sound: "default" }),
    });
  } catch (_) { /* an alert must never break the request it is warning about */ }
}

/** True when today's dollar budget is gone.
 *
 *  FAILS CLOSED. A discarded error plus `?.tripped === true` renders an
 *  unreadable switch as "nothing spent yet", which is the wrong way round on a
 *  function whose job is spending money. A MISSING ROW is not an error: the row
 *  is created by the day's first call, so absent legitimately means zero. */
export async function isGoogleBudgetSpent(nextMicros = 0): Promise<boolean> {
  const cap = dailyBudgetMicros();
  if (cap === 0 || !Number.isSafeInteger(nextMicros) || nextMicros < 0) return true;
  const { data, error } = await admin
    .from("google_usage_counter")
    .select("tripped, spend_micros")
    .eq("day", todayUTC())
    .maybeSingle();
  if (error) {
    console.error("google-spend: kill switch unreadable, refusing to spend", error.message);
    return true;
  }
  if (data === null) return nextMicros > cap;
  const row = data as { tripped?: boolean; spend_micros?: number };
  // A lowered cap takes effect without waiting for the old one-shot trip flag.
  // This read is NOT an atomic reservation: parallel requests can still race.
  if (typeof row.spend_micros !== "number" || !Number.isSafeInteger(row.spend_micros) || row.spend_micros < 0) return true;
  return row.tripped === true || row.spend_micros >= cap || nextMicros > cap - row.spend_micros;
}

/**
 * Reserve estimated cost BEFORE contacting Google. The existing SQL RPC locks
 * today's row and returns this reservation's total. The earlier read is only
 * an optimization: concurrent callers may all pass it, but only reservations
 * whose returned total fits the cap may perform a Google request.
 *
 * Reservations are conservative, not an invoice: failed/uncertain RPC replies
 * may consume budget twice on retry, and failed fetches retain their reservation.
 * Never refund an uncertain request, since Google may already have served it.
 * All deployed spenders must use this path for a fleet-wide guarantee.
 */
export async function spendGoogle(
  opts: { sku: GoogleSku; url: string; init?: RequestInit },
): Promise<Response | null> {
  const micros = skuMicros(opts.sku);
  if (!Number.isSafeInteger(micros) || micros < 0) return null;
  const cap = dailyBudgetMicros();
  try {
    if (await isGoogleBudgetSpent(micros)) return null;
  } catch {
    console.error("google-spend: budget lookup failed, refusing to spend");
    return null;
  }
  // Attribute the reservation to its admission day, even if fetch crosses UTC
  // midnight. Do not re-read the day between retry attempts.
  const day = todayUTC();
  type Reservation = {
    new_spend_micros: number; new_count: number;
    crossed_warn: boolean; crossed_trip: boolean;
  };
  let reserved: Reservation | null = null;
  for (let attempt = 0; attempt < 2 && !reserved; attempt++) {
    try {
      const { data, error } = await admin.rpc("bump_google_spend", {
        p_day: day, p_micros: micros, p_cap_micros: cap,
      });
      const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
      if (error || !row || !Number.isSafeInteger(row.new_spend_micros) || row.new_spend_micros < micros ||
          !Number.isSafeInteger(row.new_count) || row.new_count < 1 ||
          typeof row.crossed_warn !== "boolean" || typeof row.crossed_trip !== "boolean") {
        console.error("google-spend: reservation unconfirmed; no Google request made");
        continue;
      }
      reserved = row as Reservation;
    } catch {
      console.error("google-spend: reservation failed; no Google request made");
    }
  }
  if (!reserved) return null;

  if (reserved.crossed_warn) {
    await alertPush(
      "Palate — Google budget at 80%",
      `${usd(reserved.new_spend_micros)} of ${usd(cap)} reserved today across ${reserved.new_count} reservation attempts. Actual billing may be lower.`,
    );
  }
  if (reserved.crossed_trip) {
    await alertPush(
      "⚠️ Palate Google budget reserved",
      `The ${usd(cap)} Google budget is exhausted or fully reserved — further requests use cached results until 00:00 UTC.`,
    );
  }
  // A racing request may have reserved the last slot after our preflight read.
  // An over-cap reservation stays counted, but must NEVER reach Google.
  if (reserved.new_spend_micros > cap) return null;
  return fetch(opts.url, opts.init);
}
