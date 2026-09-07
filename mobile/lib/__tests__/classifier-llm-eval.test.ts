import { classifyWithLLM, type AnthropicMessageCreate } from "../../../supabase/functions/_shared/llm-classifier";
import { deriveClassification, type GooglePlace } from "../../../supabase/functions/_shared/classifier";
import { GOLDEN, type GoldenCase } from "../../../evals/classifier/golden";
import { tally, format, outcomeOf } from "../../../evals/classifier/score";
import { addUsage, costUsd, project, formatUsd, ZERO_USAGE, type Usage } from "../../../evals/classifier/cost";

// ============================================================================
// The paid half of the eval. Costs money, so it refuses to run by accident.
// ----------------------------------------------------------------------------
// Two gates, both required: ANTHROPIC_API_KEY must exist AND RUN_LLM_EVAL must
// be 1. A key sitting in the environment for some other reason must never turn
// the ordinary test suite into a bill, and `npx jest` is run dozens of times a
// day here.
//
//   RUN_LLM_EVAL=1 EVAL_LIMIT=20 npx jest classifier-llm-eval
//
// EVAL_LIMIT caps the number of places, defaulting to 20. It answers the
// question worth answering before any backfill: on cases where the rules
// abstain, does the LLM actually get it right, and what does it cost per place
// once the cached system prompt is accounted for.
// ============================================================================

const KEY = process.env.ANTHROPIC_API_KEY;
const ARMED = process.env.RUN_LLM_EVAL === "1" && !!KEY;
const LIMIT = Number(process.env.EVAL_LIMIT ?? 20);

function asPlace(c: GoldenCase): GooglePlace {
  return { id: `golden-${c.name}`, displayName: { text: c.name }, primaryType: c.primaryType, types: c.types };
}

let spent: Usage = ZERO_USAGE;

/** The Anthropic SDK's messages.create, as plain fetch. The classifier takes a
 *  structural callable precisely so no SDK has to be installed to use it. */
const create: AnthropicMessageCreate = async (params) => {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  spent = addUsage(spent, body.usage ?? {});
  return body;
};

(ARMED ? describe : describe.skip)("classifier eval — LLM half (SPENDS MONEY)", () => {
  it(`runs ${LIMIT} places and reports accuracy and measured cost`, async () => {
    // The cases the rules cannot reach are the whole reason to pay for this,
    // so they go first and the limit bites on the rest.
    const ordered = [...GOLDEN].sort((a, b) => {
      const aRules = deriveClassification(asPlace(a)).cuisine_type;
      const bRules = deriveClassification(asPlace(b)).cuisine_type;
      return (aRules === null ? 0 : 1) - (bRules === null ? 0 : 1);
    });
    const cases = ordered.slice(0, Math.max(1, LIMIT));

    const rows: Array<{ name: string; expected: string | null; rules: string | null; llm: string | null }> = [];
    for (const c of cases) {
      const rules = deriveClassification(asPlace(c)).cuisine_type;
      let llm: string | null = null;
      try {
        const s = await classifyWithLLM(
          { name: c.name, types: c.types, primaryType: c.primaryType ?? null, priceLevel: null, userRatingCount: null },
          create,
        );
        llm = s.cuisine_type;
      } catch (e) {
        console.log(`  [error] ${c.name}: ${(e as Error).message}`);
      }
      rows.push({ name: c.name, expected: c.expected, rules, llm });
    }

    const rulesTally = tally(rows.map((r) => ({ expected: r.expected, actual: r.rules })));
    const llmTally = tally(rows.map((r) => ({ expected: r.expected, actual: r.llm })));

    console.log(`\nON THE SAME ${rows.length} CASES`);
    console.log(`  rules : ${format(rulesTally)}`);
    console.log(`  llm   : ${format(llmTally)}`);
    console.log("  --- where they differ ---");
    for (const r of rows.filter((x) => x.rules !== x.llm)) {
      console.log(`  ${r.name}: rules=${r.rules ?? "abstain"} llm=${r.llm ?? "abstain"} expected=${r.expected ?? "abstain"}`
        + `  [llm ${outcomeOf(r.expected, r.llm)}]`);
    }
    const measured = costUsd(spent);
    console.log(`\nCOST  measured ${formatUsd(measured)} over ${rows.length} places`
      + `  (in=${spent.input_tokens} out=${spent.output_tokens}`
      + ` cacheRead=${spent.cache_read_input_tokens} cacheWrite=${spent.cache_creation_input_tokens})`);
    console.log(`      per place ${formatUsd(measured / Math.max(1, rows.length))}`);
    console.log(`      1,342 eligible places would cost ~${formatUsd(project(spent, rows.length, 1342))}`);
    console.log(`      284 never-classified would cost ~${formatUsd(project(spent, rows.length, 284))}\n`);

    // The one thing that would make a backfill a bad idea: the LLM inventing
    // cuisines for places that have none. Cheaper to learn here than across
    // 1,342 rows that then feed everybody's taste graph.
    expect(llmTally.overreach).toBe(0);
  }, 180_000);
});

// Always runs, costs nothing: proves the gate is what keeps the bill at zero.
describe("the paid eval stays off unless it is asked for", () => {
  it("needs both an API key and an explicit opt-in", () => {
    expect(ARMED).toBe(process.env.RUN_LLM_EVAL === "1" && !!process.env.ANTHROPIC_API_KEY);
    if (process.env.RUN_LLM_EVAL !== "1") expect(ARMED).toBe(false);
  });
});
