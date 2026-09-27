// ============================================================================
// reclassify — bounded, resumable re-classification of cached restaurants.
// ----------------------------------------------------------------------------
// Classifier changes only affect places as they are re-fetched, so improvements
// land live but inert. As of writing: 933 of 1000 cached rows carry no opening
// hours, and every eligibility-0 row predates the nightclub / Cook Out /
// Scooter's / Topgolf rules. The fixes are deployed and ~93% of the cache has
// never seen them.
//
// This spends real money — one Google Place Details call per row — so it is
// built to be watched: hard per-run cap, oldest-refreshed first, resumable, and
// it stops the moment the shared daily kill switch trips.
//
// DRY RUN IS THE DEFAULT. It reports what a real run would cost and touches
// nothing. Pass { "commit": true } to actually spend.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { googleToRestaurantRow, type GooglePlace } from "../_shared/classifier.ts";
import {
  dailyBudgetMicros,
  isGoogleBudgetSpent,
  skuMicros,
  spendGoogle,
} from "../_shared/google-spend.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

/** Ceiling per invocation. An edge function has a wall clock, and a run that
 *  dies mid-way should have done bounded, known work rather than an unknown
 *  amount. */
const MAX_PER_RUN = 100;

/** Strikes before a google_place_id is retired from the reviews queue. A 5xx
 *  or a rate-limit is transient and a row should survive it; an ID that fails
 *  three separate runs is a place Google has removed. Retiring costs us one
 *  row of text — not retiring cost $0.025 every ten minutes, forever. */
const MAX_REVIEW_ATTEMPTS = 3;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const todayUTC = () => new Date().toISOString().slice(0, 10);

/** `ReturnType<typeof createClient>` resolves the generic DEFAULTS, not the
 *  type this file actually constructs, so every helper taking an admin client
 *  failed to typecheck against the client passed to it. Naming the constructor
 *  and deriving from that gives the real inferred type. */
function makeAdmin() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}
type Admin = ReturnType<typeof makeAdmin>;

// The kill switch, the SKU price table, the meter and the 80%/tripped alert
// all live in ../_shared/google-spend.ts now. This function used to keep its
// own copy of the gate and call bump_google_usage WITHOUT reading the
// crossed_warn/crossed_trip flags it returns — so the nightly backfill ate
// both one-shot alerts at 2am and nobody was told for eight days.

/** Google's review text, flattened to the snippets column. */
function reviewSnippetsOf(place: { reviews?: Array<{ text?: { text?: string } }> }): string[] {
  return (place.reviews ?? [])
    .map((r) => r?.text?.text)
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .slice(0, 5);
}

/** The cheap structural mask, and the one that also carries review text. */
const MASK_STRUCTURAL =
  "id,displayName,formattedAddress,shortFormattedAddress,addressComponents,location," +
  "primaryType,types,priceLevel,rating,userRatingCount,regularOpeningHours";
const MASK_WITH_REVIEWS =
  MASK_STRUCTURAL +
  ",businessStatus,editorialSummary,reviews," +
  "goodForGroups,goodForChildren,menuForChildren,goodForWatchingSports,liveMusic," +
  "reservable,outdoorSeating,servesBreakfast,servesBrunch,servesLunch,servesDinner," +
  "servesBeer,servesWine,servesCocktails,servesVegetarianFood,servesDessert," +
  "allowsDogs,delivery,takeout,dineIn";

/** The two masks are two different SKUs at two different prices — which is the
 *  whole reason the budget is now denominated in dollars. Derived from the
 *  shared table so a price correction lands here automatically. */
const skuFor = (wantReviews: boolean) =>
  wantReviews ? "details_enterprise_atmosphere" as const : "details_pro" as const;
const usdPerCall = (wantReviews: boolean) => skuMicros(skuFor(wantReviews)) / 1_000_000;

/** The corridor the product actually serves. Two users: Newport News VA (often
 *  DC) and Philadelphia (two months in NYC, home to Maryland often). Sweeping
 *  review text nationwide cost $300 for rows nobody can be recommended.
 *
 *  Widen this when there are users to widen it for. { scope: "all" } opts out
 *  deliberately — a parameter rather than a code edit, so going nationwide is
 *  a visible act at the call site instead of a diff nobody reads. */
const METROS: Array<{ name: string; lat: [number, number]; lng: [number, number] }> = [
  { name: "Hampton Roads", lat: [36.7, 37.4], lng: [-76.8, -75.9] },
  { name: "DC",            lat: [38.7, 39.2], lng: [-77.3, -76.8] },
  { name: "Baltimore",     lat: [39.1, 39.5], lng: [-76.8, -76.4] },
  { name: "Philadelphia",  lat: [39.8, 40.2], lng: [-75.4, -74.9] },
  { name: "NYC",           lat: [40.5, 41.0], lng: [-74.3, -73.7] },
];

/** The metro boxes as one PostgREST `or=` disjunction. */
const METRO_OR = METROS
  .map((m) =>
    `and(latitude.gte.${m.lat[0]},latitude.lte.${m.lat[1]},` +
    `longitude.gte.${m.lng[0]},longitude.lte.${m.lng[1]})`
  )
  .join(",");

/** Null means "never classified", which the rest of the codebase reads as
 *  eligible (`coalesce(recommendation_eligibility, 1) > 0`). Matched here
 *  rather than inventing a stricter rule in one more place. */
const ELIGIBLE_OR = "recommendation_eligibility.is.null,recommendation_eligibility.gt.0";

/** Rows still owed review text: unfilled, not retired, eligible, and — unless
 *  explicitly unscoped — inside the corridor.
 *
 *  `.is(reviews_refreshed_at, null)` is a FILTER, not just an ordering. The
 *  old sweep ordered nulls-first without filtering, so once the nulls ran
 *  short each run topped its batch up with rows that already had text and paid
 *  $0.025 apiece to overwrite them. Multiple `.or()` calls are ANDed together
 *  by PostgREST, so the metro and eligibility disjunctions both apply. */
function reviewsQueue(
  admin: Admin,
  scoped: boolean,
  select: string,
  opts?: { count: "exact"; head: boolean },
) {
  const q = admin
    .from("restaurants")
    .select(select, opts)
    .is("reviews_refreshed_at", null)
    .lt("reviews_attempts", MAX_REVIEW_ATTEMPTS)
    .or(ELIGIBLE_OR);
  return scoped ? q.or(METRO_OR) : q;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Admin/cron only. This spends money; it must never be reachable with the
  // public anon key alone.
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const commit = body.commit === true;
  const limit = Math.min(Number(body.limit ?? MAX_PER_RUN), MAX_PER_RUN);
  // reviews:true asks Google for editorialSummary + reviews + the atmosphere
  // booleans. Same ONE Place Details call either way — a field mask changes
  // which SKU that call is billed at, not how many calls are made — so this
  // costs the same number of requests and more per request.
  //
  // It does NOT run the LLM. Deriving vibe from this text is a separate spend
  // against a separate ceiling, and bundling them would mean one flag quietly
  // authorising two budgets.
  const wantReviews = body.reviews === true;
  const admin = makeAdmin();

  // Scoped unless told otherwise. See METROS: nationwide is the expensive
  // default, and it should have to be asked for.
  const scoped = wantReviews && body.scope !== "all";

  // Structural mode is unchanged: oldest-refreshed first, so repeated runs
  // sweep the whole table instead of re-doing the same head, and refreshed_at
  // advancing IS the resumption mechanism.
  //
  // Reviews mode no longer sweeps by age at all. It walks a QUEUE — rows with
  // no text, not retired, eligible, in scope — and rows leave that queue by
  // being filled or by striking out. Ordering is by created_at purely for a
  // stable cursor; every row in the queue is equally unfilled, so ordering by
  // reviews_refreshed_at (all null) decided nothing and let failures shuffle
  // the head between runs.
  const { data: rows, error } = wantReviews
    ? await reviewsQueue(admin, scoped, "google_place_id, name, reviews_attempts")
        .order("created_at", { ascending: true })
        .limit(limit)
    : await admin
        .from("restaurants")
        .select("google_place_id, name, refreshed_at")
        .order("refreshed_at", { ascending: true, nullsFirst: true })
        .limit(limit);
  if (error) return json({ error: error.message }, 500);

  const batch = (rows ?? []) as Array<
    { google_place_id: string; name: string; reviews_attempts?: number }
  >;

  if (!commit) {
    const { count: total } = await admin
      .from("restaurants").select("google_place_id", { count: "exact", head: true });

    // What the sweep would actually cost, end to end — not just this batch.
    // The old dry run derived runs_needed from the WHOLE table even in reviews
    // mode, so it reported a sweep far larger than the work outstanding and
    // never put a dollar figure on any of it.
    const head = { count: "exact", head: true } as const;
    const queued = wantReviews
      ? (await reviewsQueue(admin, scoped, "google_place_id", head)).count ?? null
      : null;
    const queuedUnscoped = wantReviews
      ? (await reviewsQueue(admin, false, "google_place_id", head)).count ?? null
      : null;
    const retired = wantReviews
      ? (await admin.from("restaurants").select("google_place_id", head)
          .gte("reviews_attempts", MAX_REVIEW_ATTEMPTS)).count ?? null
      : null;

    const outstanding = wantReviews ? queued : total;
    return json({
      dry_run: true,
      would_process_now: batch.length,
      total_rows: total ?? null,
      mode: wantReviews ? "reviews (rich field mask)" : "structural (cheap field mask)",
      scope: wantReviews
        ? (scoped ? METROS.map((m) => m.name).join(" / ") : "ALL METROS (unscoped)")
        : null,
      queued_in_scope: queued,
      queued_unscoped: queuedUnscoped,
      retired_unfetchable: retired,
      google_calls_per_run: batch.length,
      runs_needed: outstanding != null ? Math.ceil(outstanding / limit) : null,
      est_usd_to_finish: wantReviews && queued != null
        ? Number((queued * usdPerCall(true)).toFixed(2))
        : null,
      note:
        "One Place Details call per row. Nothing was fetched or written. " +
        "Send { commit: true } to spend." +
        (wantReviews
          ? ` reviews:true bills at the Enterprise + Atmosphere SKU (~$${usdPerCall(true)}/call)` +
            " and stores text that expires at 30 days (migration 0173)." +
            (scoped ? "" : " SCOPE IS ALL METROS — this is the nationwide sweep that cost $300.")
          : ""),
      daily_budget_usd: dailyBudgetMicros() / 1_000_000,
      calls_the_budget_allows: Math.floor(dailyBudgetMicros() / skuMicros(skuFor(wantReviews))),
      budget_already_spent: await isGoogleBudgetSpent(),
    });
  }

  let updated = 0, skipped = 0, failed = 0;
  const changes: Array<{ place_id: string; name: string; note: string }> = [];

  // A failed fetch MUST move the row out of the head of the queue. When it did
  // not, the sweep re-paid for the same dead place_id on every run and the
  // cron's "no nulls left" guard could never go false — which is how a job
  // documented as self-terminating ran eight days at the cap. Structural mode
  // advances refreshed_at; reviews mode banks a strike, and MAX_REVIEW_ATTEMPTS
  // of them retires the row entirely (0177).
  const recordFailure = async (
    row: { google_place_id: string; reviews_attempts?: number },
  ) => {
    const patch = wantReviews
      ? { reviews_attempts: (row.reviews_attempts ?? 0) + 1 }
      : { refreshed_at: new Date().toISOString() };
    await admin.from("restaurants").update(patch).eq("google_place_id", row.google_place_id);
  };

  for (const row of batch) {
    // Re-checked EVERY iteration, not once: a long run can cross the cap
    // mid-way, and the point of a kill switch is that it stops things.
    try {
      // spendGoogle re-checks the budget, prices the call by SKU, meters it and
      // raises the 80%/tripped alerts. A null means the budget is gone mid-run,
      // which is the point of a kill switch on a long sweep.
      const resp = await spendGoogle({
        sku: skuFor(wantReviews),
        url: `https://places.googleapis.com/v1/places/${row.google_place_id}`,
        init: {
          headers: {
            "X-Goog-Api-Key": GOOGLE_KEY,
            "X-Goog-FieldMask": wantReviews ? MASK_WITH_REVIEWS : MASK_STRUCTURAL,
          },
        },
      });
      if (!resp) { skipped++; continue; }
      await admin.rpc("record_api_usage", { p_day: todayUTC(), p_action: "reclassify", p_source: "google" });

      if (!resp.ok) {
        await recordFailure(row);
        failed++;
        continue;
      }
      const place = await resp.json();

      // googleToRestaurantRow is the PURE deterministic builder. The LLM
      // enrichment path lives inside places-proxy and is deliberately not used
      // here: this is a bulk structural pass over rules that need no model, and
      // paying for a thousand LLM calls to re-derive vibe tags is a separate
      // decision from paying for a thousand Places lookups.
      const built = googleToRestaurantRow(place as GooglePlace) as Record<string, unknown>;
      if (wantReviews) {
        // Google's text, cached under the 30-day terms and expired by the
        // prune_stale_review_text cron (0173). The DERIVED tags that
        // googleToRestaurantRow produces are ours and outlive it.
        const snippets = reviewSnippetsOf(place as { reviews?: Array<{ text?: { text?: string } }> });
        const summary = (place as { editorialSummary?: { text?: string } }).editorialSummary?.text ?? null;
        built.review_snippets = snippets.length ? snippets : null;
        built.editorial_summary = summary;
        // Stamped even when Google returned nothing, so a place with no reviews
        // is not re-fetched on every single run forever. It ages out at 30 days
        // like anything else and gets one more try then.
        built.reviews_refreshed_at = new Date().toISOString();
        // Strikes are consecutive: a row that finally answers starts clean.
        built.reviews_attempts = 0;
      }
      await admin.from("restaurants").upsert(built, { onConflict: "google_place_id" });
      updated++;
      if (changes.length < 25) {
        changes.push({
          place_id: row.google_place_id,
          name: row.name,
          note: `eligibility=${(built as { recommendation_eligibility?: number }).recommendation_eligibility}`,
        });
      }
    } catch {
      // A thrown fetch left the row unstamped too, so it led the next run and
      // was re-paid for exactly like an !ok response. Same strike, same exit.
      await recordFailure(row).catch(() => {});
      failed++; // one bad row must never abort the sweep
    }
  }

  // What is left. "Done" is this reaching 0, not the batch coming back short —
  // a short batch used to mean the sweep had run out of NULLS and was about to
  // start re-buying text it already had.
  const remaining = wantReviews
    ? (await reviewsQueue(admin, scoped, "google_place_id", { count: "exact", head: true })).count ?? null
    : null;

  return json({
    dry_run: false,
    mode: wantReviews ? "reviews" : "structural",
    scope: wantReviews
      ? (scoped ? METROS.map((m) => m.name).join(" / ") : "ALL METROS (unscoped)")
      : null,
    processed: batch.length, updated, skipped, failed, sample: changes,
    queue_remaining: remaining,
    est_usd_spent_this_run: wantReviews
      ? Number(((updated + failed) * usdPerCall(true)).toFixed(2))
      : null,
  });
});
