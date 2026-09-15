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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const GOOGLE_DAILY_CALL_CAP = Number(Deno.env.get("GOOGLE_DAILY_CALL_CAP") ?? "1500");

/** Ceiling per invocation. An edge function has a wall clock, and a run that
 *  dies mid-way should have done bounded, known work rather than an unknown
 *  amount. */
const MAX_PER_RUN = 100;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const todayUTC = () => new Date().toISOString().slice(0, 10);

// FAILS CLOSED. This discarded its error, and `?.tripped === true` renders a
// failed read as false — "budget not spent" — so a transient timeout reopened
// the kill switch on a function whose whole job is spending money. Same shape
// as the gates corrected in places-proxy and classify-cuisine-backfill.
// A MISSING ROW is not an error: the counter row is created on the day's first
// call, so no row legitimately means nothing spent yet.
async function budgetSpent(admin: ReturnType<typeof createClient>): Promise<boolean> {
  const { data, error } = await admin
    .from("google_usage_counter").select("tripped").eq("day", todayUTC()).maybeSingle();
  if (error) {
    console.error("reclassify: kill switch unreadable, refusing to spend", error.message ?? error);
    return true;
  }
  return (data as { tripped?: boolean } | null)?.tripped === true;
}

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
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Oldest-refreshed first, so repeated runs sweep the whole table instead of
  // re-doing the same head every time. That IS the resumption mechanism —
  // refreshed_at advances as rows are processed, so a second run continues.
  // In reviews mode, sweep by what is MISSING rather than by age: the point is
  // to fill review_snippets, and a row refreshed yesterday by the structural
  // pass still has none. Ordering by reviews_refreshed_at nulls-first walks
  // exactly the unfilled rows and then the oldest-cached ones, which is also
  // the right order for re-fetching text that has expired at 30 days.
  const query = admin
    .from("restaurants")
    .select("google_place_id, name, refreshed_at, reviews_refreshed_at")
    .limit(limit);
  const { data: rows, error } = wantReviews
    ? await query.order("reviews_refreshed_at", { ascending: true, nullsFirst: true })
    : await query.order("refreshed_at", { ascending: true, nullsFirst: true });
  if (error) return json({ error: error.message }, 500);

  const batch = (rows ?? []) as Array<{ google_place_id: string; name: string }>;

  if (!commit) {
    const { count: total } = await admin
      .from("restaurants").select("google_place_id", { count: "exact", head: true });
    return json({
      dry_run: true,
      would_process_now: batch.length,
      total_rows: total ?? null,
      runs_needed: total ? Math.ceil(total / limit) : null,
      google_calls_per_run: batch.length,
      mode: wantReviews ? "reviews (rich field mask)" : "structural (cheap field mask)",
      still_missing_review_text: wantReviews
        ? (await admin.from("restaurants")
            .select("google_place_id", { count: "exact", head: true })
            .is("reviews_refreshed_at", null)).count ?? null
        : null,
      note:
        "One Place Details call per row. Nothing was fetched or written. " +
        "Send { commit: true } to spend." +
        (wantReviews
          ? " reviews:true bills this call at the richer SKU and stores text that expires at 30 days (migration 0173)."
          : ""),
      daily_cap: GOOGLE_DAILY_CALL_CAP,
      budget_already_spent: await budgetSpent(admin),
    });
  }

  let updated = 0, skipped = 0, failed = 0;
  const changes: Array<{ place_id: string; name: string; note: string }> = [];

  for (const row of batch) {
    // Re-checked EVERY iteration, not once: a long run can cross the cap
    // mid-way, and the point of a kill switch is that it stops things.
    if (await budgetSpent(admin)) { skipped++; continue; }
    try {
      const resp = await fetch(
        `https://places.googleapis.com/v1/places/${row.google_place_id}`,
        {
          headers: {
            "X-Goog-Api-Key": GOOGLE_KEY,
            "X-Goog-FieldMask": wantReviews ? MASK_WITH_REVIEWS : MASK_STRUCTURAL,
          },
        },
      );
      await admin.rpc("bump_google_usage", { p_day: todayUTC(), p_cap: GOOGLE_DAILY_CALL_CAP });
      await admin.rpc("record_api_usage", { p_day: todayUTC(), p_action: "reclassify", p_source: "google" });

      if (!resp.ok) {
        // Advance the cursor anyway. The sweep orders by refreshed_at, so a
        // row whose fetch fails sat at the head forever and every run re-paid
        // for the same failure. Found by the code review.
        await admin.from("restaurants").update({ refreshed_at: new Date().toISOString() }).eq("google_place_id", row.google_place_id);
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
      failed++; // one bad row must never abort the sweep
    }
  }

  return json({
    dry_run: false,
    mode: wantReviews ? "reviews" : "structural",
    processed: batch.length, updated, skipped, failed, sample: changes,
  });
});
