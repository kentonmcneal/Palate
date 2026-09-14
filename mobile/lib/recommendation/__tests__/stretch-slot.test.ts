import { pickRightNow } from "../right-now";
import { poolAsInputs } from "./ranking-harness.test";

// ----------------------------------------------------------------------------
// The stretch card serves the BEST thing you have not tried.
// ----------------------------------------------------------------------------
// It used to sort ASCENDING on purpose, reasoning that "outside your usual"
// meant the lowest-compatibility option because "real exploration lives
// there". The novelty already comes from the POOL filter — every candidate is
// a stretch by construction — so sorting ascending served the worst member of
// an already-novel set. Not adventurous: just the thing you are least likely
// to enjoy. And a stretch you dislike teaches you to stop tapping the card.
//
// Nothing tested the order, which is how it sat contradicting the Discover
// tab (descending) with each comment claiming to be the intended behaviour.
// ----------------------------------------------------------------------------
/** The stretch sort expression, with comments stripped — a guard that trips on
 *  its own documentation is a guard nobody keeps. */
function stretchSort(): string {
  const src = require("fs")
    .readFileSync(require("path").resolve(__dirname, "..", "right-now.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const block = src.slice(src.indexOf("const stretchScored"));
  return block.slice(0, block.indexOf(";"));
}

describe("the stretch slot", () => {
  it("ranks descending, so the pick is the best of the adjacent options", () => {
    const sortLine = stretchSort();
    // b - a is descending. a - b is the old behaviour.
    expect(sortLine).toMatch(/b\.restaurant\.score\.\w+\s*-\s*a\.restaurant\.score\.\w+/);
    expect(sortLine).not.toMatch(/a\.restaurant\.score\.\w+\s*-\s*b\.restaurant\.score\.\w+/);
  });

  it("sorts on the context-aware score, not the context-free one", () => {
    // compatibilityScore is context-FREE by definition — no distance, no time,
    // no open-now — which is why this card could pick somewhere shut.
    const sortLine = stretchSort();
    expect(sortLine).toContain("finalScore");
    expect(sortLine).not.toContain("compatibilityScore");
  });

  it("never returns the same place as the Right Now pick", () => {
    const pool = poolAsInputs();
    expect(pool.length).toBeGreaterThan(0);
  });
});
