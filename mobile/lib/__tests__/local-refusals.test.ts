import { REFUSAL_RADIUS_M, DROP_AFTER_LOCAL_REFUSALS } from "../visits";

// ============================================================================
// A refusal is evidence about a venue AT A POSITION, not about a brand.
// ----------------------------------------------------------------------------
// The founder, standing inside a Walmart, was asked whether he had eaten at the
// Panda Express across the car park. Under the old place-level rule, refusing
// it taught the app that he dislikes Panda Express — demoting one he genuinely
// eats at elsewhere — while never learning the thing that was actually wrong:
// that venue, from that spot.
//
// Two refusals at a spot now DROP the candidate there rather than demoting it.
// Demotion was the old answer and it is not enough: a demoted place still
// appears, so somebody who has said "not here" twice keeps being asked and
// stops trusting the prompt.
// ============================================================================

describe("the shape of the rule", () => {
  it("drops after two refusals, not one", () => {
    // One refusal is a mistake, a bad fix, or a day somebody was in a hurry.
    // Two at the same spot is a pattern.
    expect(DROP_AFTER_LOCAL_REFUSALS).toBe(2);
  });

  it("counts a refusal as local well beyond the resolve radius", () => {
    // Resolution looks 75m out. Refusals have to match more loosely than that:
    // the same doorway is recorded with different GPS error every time, and two
    // fixes for one spot can sit 100m apart in a city. Too tight and the same
    // wrong venue is asked about forever because no refusal ever "matches".
    expect(REFUSAL_RADIUS_M).toBeGreaterThan(75);
    expect(REFUSAL_RADIUS_M).toBeLessThanOrEqual(200);
  });
});

describe("what the pipeline does with it", () => {
  const src = require("fs").readFileSync(
    require("path").resolve(__dirname, "..", "passive-pipeline.ts"), "utf8",
  );

  it("filters candidates by refusals near the stop, before ranking", () => {
    // Order matters: ranking a venue and then hiding it still spends the work
    // and still lets it win a slot that a real candidate should have had.
    const filterAt = src.indexOf("refusedHere");
    const rankAt = src.indexOf("rankCandidates(raw, eligible");
    expect(filterAt).toBeGreaterThan(-1);
    expect(rankAt).toBeGreaterThan(filterAt);
  });

  it("asks once for every candidate rather than once per candidate", () => {
    // This runs on a background wake. Ten round trips is the difference
    // between logging a meal and missing it.
    expect(src).toMatch(/refusalsNearStop\(\s*\n?\s*byType\.map/);
  });

  it("names the resulting silence as something learned, not something broken", () => {
    expect(src).toContain("all_refused_here");
  });
});

describe("the wiring that makes it live rather than dead", () => {
  const fs = require("fs");
  const path = require("path");
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", "..", p), "utf8");

  // Every piece below was missing when the feature was first written, and any
  // one of them missing means prompt_decisions.lat stays null forever and
  // nothing is ever learned about a spot. That is the failure this codebase
  // keeps producing: a complete mechanism with no caller.
  it("carries the stop onto the inbox entry", () => {
    const src = read("lib/passive-confirm.ts");
    expect(src).toMatch(/stopLat: resolved\.raw\.lat/);
    expect(src).toMatch(/stopLng: resolved\.raw\.lng/);
  });

  it("records a position with every decision the confirm screens take", () => {
    for (const screen of ["app/confirm-visit.tsx", "app/confirm-multi.tsx"]) {
      const src = read(screen);
      const decisions = src.match(/recordPromptDecision\(/g) ?? [];
      const positioned = src.match(/recordPromptDecision\([^)]*stopOf\(/g) ?? [];
      expect(decisions.length).toBeGreaterThan(0);
      expect(positioned.length).toBe(decisions.length);
    }
  });

  it("keeps coordinates out of the route, and looks them up instead", () => {
    // confirm-visit.tsx says so in a comment: place_id identifies a venue, not
    // the user's position. The inbox id is the handle; the position is read
    // from the entry behind it.
    const src = read("app/confirm-visit.tsx");
    expect(src).not.toMatch(/params\.(lat|lng)\b/);
    expect(src).toContain("inboxId: params.inbox_id");
  });
});
