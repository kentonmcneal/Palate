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

async function budgetSpent(admin: ReturnType<typeof createClient>): Promise<boolean> {
  const { data } = await admin
    .from("google_usage_counter").select("tripped").eq("day", todayUTC()).maybeSingle();
  return (data as { tripped?: boolean } | null)?.tripped === true;
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
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Oldest-refreshed first, so repeated runs sweep the whole table instead of
  // re-doing the same head every time. That IS the resumption mechanism —
  // refreshed_at advances as rows are processed, so a second run continues.
  const { data: rows, error } = await admin
    .from("restaurants")
    .select("google_place_id, name, refreshed_at")
    .order("refreshed_at", { ascending: true, nullsFirst: true })
    .limit(limit);
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
      note:
        "One Place Details call per row. Nothing was fetched or written. " +
        "Send { commit: true } to spend.",
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
            "X-Goog-FieldMask":
              "id,displayName,formattedAddress,shortFormattedAddress,addressComponents,location," +
              "primaryType,types,priceLevel,rating,userRatingCount,regularOpeningHours",
          },
        },
      );
      await admin.rpc("bump_google_usage", { p_day: todayUTC(), p_cap: GOOGLE_DAILY_CALL_CAP });
      await admin.rpc("record_api_usage", { p_day: todayUTC(), p_action: "reclassify", p_source: "google" });

      if (!resp.ok) { failed++; continue; }
      const place = await resp.json();

      // googleToRestaurantRow is the PURE deterministic builder. The LLM
      // enrichment path lives inside places-proxy and is deliberately not used
      // here: this is a bulk structural pass over rules that need no model, and
      // paying for a thousand LLM calls to re-derive vibe tags is a separate
      // decision from paying for a thousand Places lookups.
      const built = googleToRestaurantRow(place as GooglePlace);
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

  return json({ dry_run: false, processed: batch.length, updated, skipped, failed, sample: changes });
});
