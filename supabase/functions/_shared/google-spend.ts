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
// Hence: guard, fetch, price, meter and alert are a SINGLE call here. A new
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
  | "details_pro"                   // structural details: hours, rating, price
  | "search_text_pro"               // searchText with rating/hours/priceLevel
  | "search_nearby_pro"             // searchNearby with rating/hours/priceLevel
  | "ids_only";                     // field mask of ids alone — free

/** Micro-dollars (1e-6 USD) per call. Places SKUs are quoted per 1,000 calls,
 *  so $25/1000 is 25000 micros.
 *
 *  ONLY the first line is confirmed: $300 billed over eight days at a 1500/day
 *  cap divides out to exactly $0.025/call. The rest are list-price estimates —
 *  check Billing > Reports grouped by SKU and correct them here. Being roughly
 *  right is already the whole point: the old system treated a 25000 call and a
 *  0 call as identical. */
export const SKU_MICROS: Record<GoogleSku, number> = {
  details_enterprise_atmosphere: 25_000, // CONFIRMED against the Sep 2026 bill
  details_pro: 17_000,
  search_text_pro: 32_000,
  search_nearby_pro: 32_000,
  ids_only: 0,
};

/** An unrecognised SKU is priced as the most expensive thing we know about.
 *  Guessing low is how a budget gets quietly overrun; guessing high only ever
 *  degrades early, which is loud and recoverable. */
const UNKNOWN_SKU_MICROS = 35_000;

export const skuMicros = (sku: GoogleSku): number =>
  SKU_MICROS[sku] ?? UNKNOWN_SKU_MICROS;

/** The daily ceiling, in dollars. Tune with GOOGLE_DAILY_BUDGET_USD.
 *
 *  $5/day (~$150/month) against the $37.50/day (~$1,140/month) the old
 *  1500-call cap permitted once the mask went rich. What $5 actually buys:
 *
 *      ~156 search calls        (search_*_pro,  $0.032)
 *      ~294 structural details  (details_pro,   $0.017)
 *      ~200 review details      (atmosphere,    $0.025)
 *
 *  Sized so one enthusiastic phone cannot exhaust it: USER_CAP_PER_DAY is 120
 *  calls, so a single user at their own ceiling still leaves room for the
 *  other. Tighter would be cheaper, but a budget that degrades the app for
 *  real users is a worse failure than $5 — and unlike the old cap, this one
 *  now tells you at 80% the same day. */
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
 * Make one paid Google Places call, metered and alarmed.
 *
 * Returns the Response, or `null` when the configured budget is invalid or the
 * next request cannot fit the recorded remaining budget — callers
 * degrade to cached/DB results on null rather than surfacing an error.
 *
 * The bump is retried once: a silently failed bump is an uncounted billable
 * call, and enough of those mean the ceiling is never reached at all.
 */
export async function spendGoogle(
  opts: { sku: GoogleSku; url: string; init?: RequestInit },
): Promise<Response | null> {
  const micros = skuMicros(opts.sku);
  if (await isGoogleBudgetSpent(micros)) return null;
  const cap = dailyBudgetMicros();

  const resp = await fetch(opts.url, opts.init);

  // Metered AFTER the call is made, so what we count is what Google served —
  // but unconditionally, including on a non-2xx, because Google bills for
  // requests it answered and a failing call is exactly the kind that gets
  // retried in a loop.
  let bumped = null;
  for (let attempt = 0; attempt < 2 && !bumped; attempt++) {
    const { data, error } = await admin.rpc("bump_google_spend", {
      p_day: todayUTC(),
      p_micros: micros,
      p_cap_micros: cap,
    });
    if (error) {
      console.error("google-spend: BILLABLE CALL NOT COUNTED", error.message);
      continue;
    }
    bumped = (Array.isArray(data) ? data[0] : data) as {
      new_spend_micros: number; new_count: number;
      crossed_warn: boolean; crossed_trip: boolean;
    } | null;
  }

  if (bumped?.crossed_warn) {
    await alertPush(
      "Palate — Google budget at 80%",
      `${usd(bumped.new_spend_micros)} of ${usd(cap)} spent today over ${bumped.new_count} calls.`,
    );
  }
  if (bumped?.crossed_trip) {
    await alertPush(
      "⚠️ Palate kill-switch tripped",
      `Hit ${usd(cap)} of Google spend (${bumped.new_count} calls) — cached results only until 00:00 UTC.`,
    );
  }

  return resp;
}
