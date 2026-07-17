// Re-classify restaurants whose classifier_version is stale.
//
// Quick start:
//   cd supabase/scripts
//   npm install                        # one-time
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     npx tsx backfill-classifier.ts
//
//   # with LLM augmentation for low-confidence rows:
//   ANTHROPIC_API_KEY=... ... npx tsx backfill-classifier.ts --with-llm
//
// Reads rows where classifier_version != current OR classifier_version is null,
// deserializes the cached google_raw payload, re-runs the classifier (and LLM
// if requested), writes the updated rows back. Does NOT call Google — the raw
// payload is what we already have. Idempotent.
//
// Flags:
//   --with-llm        also run the LLM fallback on low-confidence rows
//   --limit=N         cap the number of rows processed (default: all)
//   --dry-run         show what would change without writing
//   --version=X.Y.Z   target a specific classifier version (default: current)

import { createClient } from "@supabase/supabase-js";
import {
  CLASSIFIER_VERSION,
  deriveClassification,
  type GooglePlace,
  googleToRestaurantRow,
  neighborhoodFromPlace,
  PRICE_LEVEL_MAP,
} from "../functions/_shared/classifier";
import {
  classifyWithLLM,
  type LLMInput,
  mergeLLMIntoDerivation,
  shouldEnrichQualitative,
  shouldUseLLM,
} from "../functions/_shared/llm-classifier";

const args = process.argv.slice(2);
const WITH_LLM = args.includes("--with-llm");
const DRY_RUN = args.includes("--dry-run");
const LIMIT = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "0", 10) || null;
const TARGET_VERSION = args.find((a) => a.startsWith("--version="))?.split("=")[1] ?? CLASSIFIER_VERSION;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required in env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log(`backfill-classifier: target version ${TARGET_VERSION}${WITH_LLM ? " (with LLM)" : ""}${DRY_RUN ? " (dry run)" : ""}`);

  // Fetch stale rows in pages. Supabase caps single .select() at 1000 rows
  // by default, but we paginate by id for predictability.
  let total = 0;
  let updated = 0;
  let llmCalls = 0;
  let lastId: string | null = null;
  const PAGE = 200;

  const create = WITH_LLM ? await getLLMCreate() : null;

  while (true) {
    let q = supabase
      .from("restaurants")
      .select("id, google_place_id, classifier_version, google_raw")
      .or(`classifier_version.is.null,classifier_version.neq.${TARGET_VERSION}`)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (lastId) q = q.gt("id", lastId);

    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      total += 1;
      if (LIMIT && total > LIMIT) {
        console.log(`reached --limit=${LIMIT}, stopping`);
        printSummary(total - 1, updated, llmCalls);
        return;
      }
      if (!row.google_raw) {
        console.warn(`  [skip] ${row.google_place_id}: no google_raw (was cached before 0027 migration)`);
        continue;
      }
      const place = row.google_raw as GooglePlace;
      let derived = deriveClassification(place);

      if (create && WITH_LLM) {
        const llmInput: LLMInput = {
          name: place.displayName?.text ?? "Unknown",
          types: place.types ?? [],
          primaryType: place.primaryType ?? null,
          priceLevel: place.priceLevel ? PRICE_LEVEL_MAP[place.priceLevel] ?? null : null,
          userRatingCount: place.userRatingCount ?? null,
          neighborhood: neighborhoodFromPlace(place),
          editorialSummary: place.editorialSummary?.text ?? null,
          reviewSnippets: (place.reviews ?? [])
            .map((r) => r.text?.text ?? "")
            .filter(Boolean),
        };
        if (shouldUseLLM(derived) || shouldEnrichQualitative(llmInput)) {
          llmCalls += 1;
          try {
            const suggestion = await classifyWithLLM(llmInput, create);
            derived = mergeLLMIntoDerivation(derived, suggestion);
          } catch (e) {
            console.error(`  [llm-fail] ${row.google_place_id}:`, e);
          }
        }
      }

      const newRow = googleToRestaurantRow(place, derived);

      if (DRY_RUN) {
        console.log(`  [would update] ${row.google_place_id} → cuisine=${newRow.cuisine_type}, subregion=${newRow.cuisine_subregion}`);
        continue;
      }

      const { error: upErr } = await supabase
        .from("restaurants")
        .update({
          cuisine_type: newRow.cuisine_type,
          cuisine_region: newRow.cuisine_region,
          cuisine_subregion: newRow.cuisine_subregion,
          format_class: newRow.format_class,
          chain_name: newRow.chain_name,
          chain_type: newRow.chain_type,
          occasion_tags: newRow.occasion_tags,
          flavor_tags: newRow.flavor_tags,
          cultural_context: newRow.cultural_context,
          // Qualitative "feel" tags — only meaningfully populated on --with-llm
          // runs, but always written so a re-run can clear stale values.
          vibe: newRow.vibe,
          crowd_energy: newRow.crowd_energy,
          menu_style: newRow.menu_style,
          price_feel: newRow.price_feel,
          ambiance_notes: newRow.ambiance_notes,
          tags: newRow.tags,
          classifier_version: newRow.classifier_version,
          classification_confidence: newRow.classification_confidence,
          recommendation_eligibility: newRow.recommendation_eligibility,
          ineligibility_reason: newRow.ineligibility_reason,
        })
        .eq("id", row.id);
      if (upErr) {
        console.error(`  [update-fail] ${row.google_place_id}:`, upErr.message);
      } else {
        updated += 1;
      }
    }
    lastId = data[data.length - 1].id;
    if (data.length < PAGE) break;
  }
  printSummary(total, updated, llmCalls);
}

function printSummary(total: number, updated: number, llmCalls: number) {
  console.log(`\nDone. scanned=${total} updated=${updated} llm_calls=${llmCalls}${DRY_RUN ? " (dry run — nothing written)" : ""}`);
}

async function getLLMCreate() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("--with-llm requires ANTHROPIC_API_KEY in env");
    process.exit(1);
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  return client.messages.create.bind(client.messages) as never;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
