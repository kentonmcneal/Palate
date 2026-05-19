// Palate classifier eval harness.
//
// Quick start:
//   cd supabase/eval
//   npm install
//   npm run eval           # deterministic only
//   npm run eval:llm       # also invokes Haiku 4.5 on low-confidence cases
//                          # (requires ANTHROPIC_API_KEY in env)
//
// Reports per-field accuracy + per-case failures. Exits non-zero on any
// failure so this can wedge into CI once we trust the metrics.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  CLASSIFIER_VERSION,
  deriveClassification,
  type DerivedClassification,
  type GooglePlace,
  PRICE_LEVEL_MAP,
} from "../functions/_shared/classifier";
import {
  classifyWithLLM,
  type LLMInput,
  mergeLLMIntoDerivation,
  shouldUseLLM,
} from "../functions/_shared/llm-classifier";

interface Case {
  id: string;
  notes?: string;
  input: GooglePlace;
  expected: Record<string, unknown>;
}

interface CasesFile {
  version: number;
  cases: Case[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_PATH = resolve(HERE, "cases.json");
const WITH_LLM = process.argv.includes("--with-llm");

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
};

function compareField(
  expectedKey: string,
  expectedVal: unknown,
  actual: DerivedClassification,
): { fieldUnderTest: string; pass: boolean; actualVal: unknown } {
  if (expectedKey.endsWith("_include")) {
    const field = expectedKey.slice(0, -"_include".length) as keyof DerivedClassification;
    const actualArr = (actual[field] as unknown[]) ?? [];
    const wanted = expectedVal as unknown[];
    const pass = wanted.every((w) => actualArr.includes(w));
    return { fieldUnderTest: field as string, pass, actualVal: actualArr };
  }
  const field = expectedKey as keyof DerivedClassification;
  const actualVal = actual[field];
  return { fieldUnderTest: field as string, pass: actualVal === expectedVal, actualVal };
}

interface RunStats {
  fieldStats: Map<string, { pass: number; total: number }>;
  failures: Array<{
    caseId: string;
    field: string;
    expected: unknown;
    actual: unknown;
    notes?: string;
  }>;
}

function evaluateCases(
  cases: Case[],
  classify: (c: Case) => Promise<DerivedClassification>,
): Promise<RunStats> {
  return (async () => {
    const fieldStats = new Map<string, { pass: number; total: number }>();
    const failures: RunStats["failures"] = [];
    for (const c of cases) {
      const actual = await classify(c);
      for (const [expectedKey, expectedVal] of Object.entries(c.expected)) {
        const { fieldUnderTest, pass, actualVal } = compareField(expectedKey, expectedVal, actual);
        const stats = fieldStats.get(fieldUnderTest) ?? { pass: 0, total: 0 };
        stats.total += 1;
        if (pass) stats.pass += 1;
        else failures.push({
          caseId: c.id,
          field: fieldUnderTest,
          expected: expectedVal,
          actual: actualVal,
          notes: c.notes,
        });
        fieldStats.set(fieldUnderTest, stats);
      }
    }
    return { fieldStats, failures };
  })();
}

function printReport(label: string, stats: RunStats, totalCases: number) {
  console.log(`\n${ANSI.bold}${label}${ANSI.reset}`);
  const sorted = [...stats.fieldStats.entries()].sort(([a], [b]) => a.localeCompare(b));
  const widest = Math.max(...sorted.map(([f]) => f.length));
  for (const [field, { pass, total }] of sorted) {
    const pct = total === 0 ? 0 : Math.round((pass / total) * 100);
    const color = pct >= 90 ? ANSI.green : pct >= 70 ? ANSI.yellow : ANSI.red;
    console.log(
      `  ${field.padEnd(widest)}  ${color}${String(pass).padStart(2)}/${String(total).padEnd(2)} (${pct}%)${ANSI.reset}`,
    );
  }
  if (stats.failures.length === 0) {
    console.log(`  ${ANSI.green}All ${totalCases} cases passed.${ANSI.reset}`);
  } else {
    console.log(`  ${ANSI.dim}${stats.failures.length} failures${ANSI.reset}`);
  }
}

function printFailures(label: string, stats: RunStats) {
  if (stats.failures.length === 0) return;
  console.log(`\n${ANSI.bold}${label} — failures:${ANSI.reset}`);
  for (const f of stats.failures) {
    const exp = JSON.stringify(f.expected);
    const act = JSON.stringify(f.actual);
    console.log(`  ${ANSI.red}[${f.caseId}]${ANSI.reset} ${f.field}: expected ${exp}, got ${act}`);
    if (f.notes) console.log(`      ${ANSI.dim}${f.notes}${ANSI.reset}`);
  }
}

async function main() {
  const raw = readFileSync(CASES_PATH, "utf8");
  const file = JSON.parse(raw) as CasesFile;

  console.log(`${ANSI.bold}Palate classifier eval${ANSI.reset}  (classifier v${CLASSIFIER_VERSION})`);
  console.log(`Cases: ${file.cases.length}${WITH_LLM ? `  ${ANSI.cyan}[--with-llm]${ANSI.reset}` : ""}`);

  // --- Deterministic pass ---
  const det = await evaluateCases(file.cases, async (c) => deriveClassification(c.input));
  printReport("Deterministic only:", det, file.cases.length);

  if (!WITH_LLM) {
    printFailures("Deterministic", det);
    if (det.failures.length > 0) process.exitCode = 1;
    return;
  }

  // --- LLM-augmented pass ---
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(`\n${ANSI.red}--with-llm set but ANTHROPIC_API_KEY is not in env. Aborting.${ANSI.reset}`);
    process.exitCode = 1;
    return;
  }
  // Lazy import so plain `npm run eval` doesn't need the SDK installed.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const create = client.messages.create.bind(client.messages);

  let llmCalls = 0;
  const llm = await evaluateCases(file.cases, async (c) => {
    const base = deriveClassification(c.input);
    if (!shouldUseLLM(base)) return base;
    llmCalls += 1;
    const input: LLMInput = {
      name: c.input.displayName?.text ?? "Unknown",
      types: c.input.types ?? [],
      primaryType: c.input.primaryType ?? null,
      priceLevel: c.input.priceLevel ? PRICE_LEVEL_MAP[c.input.priceLevel] ?? null : null,
      userRatingCount: c.input.userRatingCount ?? null,
      editorialSummary: c.input.editorialSummary?.text ?? null,
      reviewSnippets: (c.input.reviews ?? [])
        .map((r) => r.text?.text ?? "")
        .filter(Boolean),
    };
    try {
      const suggestion = await classifyWithLLM(input, create as never);
      return mergeLLMIntoDerivation(base, suggestion);
    } catch (e) {
      console.error(`  ${ANSI.red}[${c.id}] LLM call failed:${ANSI.reset}`, e);
      return base;
    }
  });
  console.log(`\n${ANSI.cyan}LLM invoked on ${llmCalls} / ${file.cases.length} cases (rest were high-confidence).${ANSI.reset}`);
  printReport("With LLM fallback:", llm, file.cases.length);

  printFailures("LLM", llm);
  if (llm.failures.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
