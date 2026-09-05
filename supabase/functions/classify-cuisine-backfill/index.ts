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

  const { data: rows, error } = await admin
    .from("restaurants")
    .select("id, google_place_id, name, types, primary_type, price_level, user_rating_count, neighborhood, cuisine_region, cuisine_subregion, occasion_tags, classification_confidence")
    .is("cuisine_type", null)
    .not("types", "is", null)
    .order("user_rating_count", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return json({ error: error.message }, 500);
  if (!rows || rows.length === 0) return json({ done: true, processed: 0 });

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  let processed = 0, written = 0, abstained = 0, failed = 0;
  const sample: Array<{ name: string; cuisine: string | null; confidence: number }> = [];

  for (const row of rows) {
    if (processed + usedToday >= LLM_DAILY_CAP) break;
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
      const s = await classifyWithLLM(input, anthropic.messages.create.bind(anthropic.messages));
      processed++;
      await admin.rpc("record_api_usage", { p_day: day, p_action: "llm_cuisine_backfill", p_source: "anthropic" });

      const conf = s.confidence?.cuisine_type ?? 0;
      if (sample.length < 15) sample.push({ name: row.name, cuisine: s.cuisine_type, confidence: conf });
      if (!s.cuisine_type || conf < MIN_CONFIDENCE) { abstained++; continue; }
      if (!commit) continue;

      const patch: Record<string, unknown> = {
        cuisine_type: s.cuisine_type,
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

  return json({ processed, written, abstained, failed, commit, remaining_estimate: rows.length === limit ? "more" : "none", sample });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
