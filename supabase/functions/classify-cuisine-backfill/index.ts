// Palate — LLM cuisine backfill.
//
// 373 rows have no cuisine_type because Google's own types only say
// "restaurant". Approved by the founder on 2026-09-05: one Haiku call per row
// over name + types + neighborhood, no Google call. Writes cuisine_type (and
// region / subregion, and occasion_tags where empty) only where the model is
// at least 0.6 confident, and only into columns that are null. Never
// overwrites a value that exists.
//
// Called by pg_cron (0100) with x-cron-secret. Fails closed without
// ANTHROPIC_API_KEY. Hard cap of LLM_DAILY_CAP calls per UTC day, so the
// worst case is bounded whatever the cron does.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { classifyWithLLM, type LLMInput } from "../_shared/llm-classifier.ts";
import { CLASSIFIER_VERSION } from "../_shared/classifier.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const LLM_DAILY_CAP = 500;

// ----------------------------------------------------------------------------
// The budget, in the units the person who approved it was thinking in.
// ----------------------------------------------------------------------------
// A cap of 500 CALLS a day bounds the rate, not the bill. Ten dollars was
// authorised, so ten dollars is what this enforces, measured against the token
// counts Anthropic reports back on every response.
const LLM_LIFETIME_CAP_USD = 10;

// Per million tokens. These are an ESTIMATE maintained by hand, and the whole
// point of the second cap below is that this line can be wrong without it
// costing anything: if the real price is five times this, the call ceiling
// still bounds the damage. Update if pricing moves.
const PRICE_PER_MTOK = {
  input: 1.00,
  output: 5.00,
  cacheRead: 0.10,
  cacheWrite: 1.25,
};

// The belt to the dollar cap's braces. There are fewer than a thousand rows
// left to classify; anything past this means a loop, not a backfill.
const LLM_LIFETIME_CAP_CALLS = 3000;

function costOf(u: {
  input_tokens?: number; output_tokens?: number;
  cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
} | null): { usd: number; input: number; output: number; cacheRead: number; cacheWrite: number } {
  const input = u?.input_tokens ?? 0;
  const output = u?.output_tokens ?? 0;
  const cacheRead = u?.cache_read_input_tokens ?? 0;
  const cacheWrite = u?.cache_creation_input_tokens ?? 0;
  const usd =
    (input / 1e6) * PRICE_PER_MTOK.input +
    (output / 1e6) * PRICE_PER_MTOK.output +
    (cacheRead / 1e6) * PRICE_PER_MTOK.cacheRead +
    (cacheWrite / 1e6) * PRICE_PER_MTOK.cacheWrite;
  return { usd, input, output, cacheRead, cacheWrite };
}
const MIN_CONFIDENCE = 0.6;
const VERSION = `${CLASSIFIER_VERSION}-llm-backfill`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!ANTHROPIC_KEY) {
    return json({ skipped: "ANTHROPIC_API_KEY not set", processed: 0 });
  }

  const body = await req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(100, Number(body.limit ?? 40)));
  const commit = body.commit === true;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Daily cap, counted from api_usage_log rows this function wrote today.
  const day = new Date().toISOString().slice(0, 10);
  const { data: usage } = await admin
    .from("api_usage_daily")
    .select("count")
    .eq("day", day)
    .eq("action", "llm_cuisine_backfill")
    .eq("source", "anthropic")
    .maybeSingle();
  const usedToday = usage?.count ?? 0;
  if (usedToday >= LLM_DAILY_CAP) {
    return json({ skipped: "daily cap reached", used_today: usedToday, processed: 0 });
  }

  // The money gate. Checked BEFORE any row is fetched, and again inside the
  // loop, so a long batch cannot run past the ceiling between checks.
  const { data: spentRaw } = await admin.rpc("llm_spend_total_usd", { p_action: "llm_cuisine_backfill" });
  let spentUsd = Number(spentRaw ?? 0);
  const { count: lifetimeCalls } = await admin
    .from("llm_spend").select("*", { count: "exact", head: true })
    .eq("action", "llm_cuisine_backfill");
  if (spentUsd >= LLM_LIFETIME_CAP_USD) {
    return json({ skipped: "lifetime spend cap reached", spent_usd: spentUsd, cap_usd: LLM_LIFETIME_CAP_USD, processed: 0 });
  }
  if ((lifetimeCalls ?? 0) >= LLM_LIFETIME_CAP_CALLS) {
    return json({ skipped: "lifetime call cap reached", calls: lifetimeCalls, processed: 0 });
  }

  const { data: rows, error } = await admin
    .from("restaurants")
    .select("id, google_place_id, name, types, primary_type, price_level, user_rating_count, neighborhood, cuisine_region, cuisine_subregion, occasion_tags, classification_confidence")
    .is("cuisine_type", null)
    // Never pay to classify somewhere that can never be recommended. 265 of
    // the 777 rows still lacking a cuisine are already marked ineligible --
    // not_a_restaurant, non_food_primary_type, national_chain, hotel, airport,
    // lounge_gated, captive_venue -- and this query never filtered on it, so a
    // third of the bill was going to read grocery stores and airport lounges.
    .is("ineligibility_reason", null)
    // Judged once. Without this, a row the model abstained on stayed null and
    // came back every ten minutes forever — a one-time $0.50 pass turned into
    // a permanent 500-calls-a-day loop. Found by the code review.
    .is("llm_backfill_at", null)
    .not("types", "is", null)
    .order("user_rating_count", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return json({ error: error.message }, 500);
  if (!rows || rows.length === 0) return json({ done: true, processed: 0 });

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

  // classifyWithLLM takes the create function, so wrapping it is enough to see
  // what every call actually cost without touching the classifier itself.
  let lastUsage: Parameters<typeof costOf>[0] = null;
  const createCounted = async (args: Parameters<typeof anthropic.messages.create>[0]) => {
    const resp = await anthropic.messages.create(args);
    lastUsage = (resp as { usage?: NonNullable<Parameters<typeof costOf>[0]> }).usage ?? null;
    return resp;
  };
  let processed = 0, written = 0, abstained = 0, failed = 0;
  const sample: Array<{ name: string; cuisine: string | null; confidence: number }> = [];

  for (const row of rows) {
    if (processed + usedToday >= LLM_DAILY_CAP) break;
    if (spentUsd >= LLM_LIFETIME_CAP_USD) break;
    try {
      const input: LLMInput = {
        name: row.name,
        types: (row.types as string[]) ?? [],
        primaryType: row.primary_type ?? null,
        priceLevel: row.price_level ?? null,
        userRatingCount: row.user_rating_count ?? null,
        neighborhood: row.neighborhood ?? null,
        editorialSummary: null,
        reviewSnippets: [],
      };
      // Counted BEFORE the call: a call that throws is still billed, and an
      // uncounted failure at temperature 0 repeats forever under the cap.
      processed++;
      await admin.rpc("record_api_usage", { p_day: day, p_action: "llm_cuisine_backfill", p_source: "anthropic" });
      const stamp = new Date().toISOString();
      let s;
      try {
        lastUsage = null;
        s = await classifyWithLLM(input, createCounted as never);
      } catch (e) {
        await admin.from("restaurants").update({ llm_backfill_at: stamp }).eq("id", row.id);
        throw e;
      }

      // Ledger first. A row that classified fine but failed to write is still
      // billed, and a cost we did not record is a cap we cannot enforce.
      {
        const c = costOf(lastUsage);
        spentUsd += c.usd;
        await admin.from("llm_spend").insert({
          action: "llm_cuisine_backfill",
          model: "claude-haiku-4-5",
          input_tokens: c.input,
          output_tokens: c.output,
          cache_read_tokens: c.cacheRead,
          cache_write_tokens: c.cacheWrite,
          est_cost_usd: Number(c.usd.toFixed(6)),
        });
      }

      const conf = s.confidence?.cuisine_type ?? 0;
      if (sample.length < 15) sample.push({ name: row.name, cuisine: s.cuisine_type, confidence: conf });
      if (!s.cuisine_type || conf < MIN_CONFIDENCE) {
        abstained++;
        if (commit) await admin.from("restaurants").update({ llm_backfill_at: stamp }).eq("id", row.id);
        continue;
      }
      if (!commit) continue;

      const patch: Record<string, unknown> = {
        cuisine_type: s.cuisine_type,
        llm_backfill_at: stamp,
        classifier_version: VERSION,
        classification_confidence: { ...(row.classification_confidence ?? {}), cuisine_type: conf, source: "llm_backfill" },
      };
      if (!row.cuisine_region && s.cuisine_region) patch.cuisine_region = s.cuisine_region;
      if (!row.cuisine_subregion && s.cuisine_subregion) patch.cuisine_subregion = s.cuisine_subregion;
      if ((!row.occasion_tags || row.occasion_tags.length === 0) && s.occasion_tags?.length) {
        patch.occasion_tags = s.occasion_tags;
      }
      const { error: upErr } = await admin.from("restaurants").update(patch).eq("id", row.id);
      if (upErr) { failed++; continue; }
      written++;
    } catch {
      failed++;
    }
  }

  return json({
    processed, written, abstained, failed, commit,
    spent_usd: Number(spentUsd.toFixed(4)),
    cap_usd: LLM_LIFETIME_CAP_USD,
    remaining_estimate: rows.length === limit ? "more" : "none",
    sample,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
