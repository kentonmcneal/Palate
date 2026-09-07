import { deriveClassification, type GooglePlace } from "../../../supabase/functions/_shared/classifier";
import { GOLDEN, type GoldenCase } from "../../../evals/classifier/golden";
import { tally, accuracy, precision, format, outcomeOf } from "../../../evals/classifier/score";

// ============================================================================
// The classifier eval that did not exist.
// ----------------------------------------------------------------------------
// The classifier prompt has moved 1.5.0 -> 1.6.0 -> 1.7.0 -> 1.8.0 with nothing
// measuring any step, and 818 of 1,720 catalogue rows carry each version. This
// runs the DETERMINISTIC half over a labelled set of real catalogue rows and
// prints a report. It costs nothing, so it runs in the normal suite.
//
// The LLM half is deliberately absent. It costs money per call, and the point
// of building this first is to know what the rules already achieve before
// paying anything to improve on them.
// ============================================================================

function asPlace(c: GoldenCase): GooglePlace {
  return {
    id: `golden-${c.name}`,
    displayName: { text: c.name },
    primaryType: c.primaryType,
    types: c.types,
  };
}

const rows = GOLDEN.map((c) => {
  const out = deriveClassification(asPlace(c));
  return {
    ...c,
    actual: out.cuisine_type,
    confidence: out.confidence?.cuisine_type ?? null,
    outcome: outcomeOf(c.expected, out.cuisine_type),
  };
});

const group = (pred: (r: (typeof rows)[number]) => boolean) =>
  tally(rows.filter(pred).map((r) => ({ expected: r.expected, actual: r.actual })));

describe("classifier eval — deterministic rules, no API calls", () => {
  const all = tally(rows.map((r) => ({ expected: r.expected, actual: r.actual })));

  it("prints the report, so a change can be seen and not only asserted", () => {
    console.log(`\nOVERALL  ${format(all)}`);
    console.log(`  explicit google type : ${format(group((r) => r.note.includes("type")))}`);
    console.log(`  answer only in name  : ${format(group((r) => r.note.startsWith("NAME")))}`);
    console.log(`  should abstain       : ${format(group((r) => r.expected === null))}`);
    const bad = rows.filter((r) => r.outcome !== "correct");
    if (bad.length) {
      console.log("  --- not correct ---");
      for (const r of bad) {
        console.log(`  [${r.outcome}] ${r.name}: expected ${r.expected ?? "abstain"}, got ${r.actual ?? "abstain"} (conf ${r.confidence ?? "-"})`);
      }
    }
    expect(rows.length).toBe(GOLDEN.length);
  });

  it("never invents a cuisine for a place that has none", () => {
    // The expensive error. A wrong cuisine is written to the catalogue and
    // moves recommendations for everybody who sees that row.
    const abstain = group((r) => r.expected === null);
    expect(abstain.overreach).toBe(0);
  });

  it("is right about nearly everything it commits to", () => {
    expect(precision(all)).toBeGreaterThanOrEqual(0.95);
  });

  it("gets every explicitly-typed place right", () => {
    // Google said the cuisine outright. Missing one of these is not a hard
    // problem, it is a broken lookup table.
    const explicit = group((r) => r.note.includes("explicit type"));
    expect(explicit.wrong).toBe(0);
    expect(explicit.missed).toBe(0);
  });

  it("holds the overall floor, so a rules change cannot quietly regress", () => {
    expect(accuracy(all)).toBeGreaterThanOrEqual(0.75);
  });
});
