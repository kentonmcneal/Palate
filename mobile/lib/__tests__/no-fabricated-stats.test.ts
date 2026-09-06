import { execSync } from "child_process";
import path from "path";
import type { TasteVector } from "../taste-vector";
import type { PalateIdentity } from "../palate-labels";
import { generatePercentileCards } from "../population-stats";

// ============================================================================
// The app may not invent a number about other people.
// ----------------------------------------------------------------------------
// It did, twice, and both times the tell was the same: a hedge word next to a
// figure nobody could source. "TOP PALATES IN PHILADELPHIA · preview" was a
// ranking of five accounts, and the founder killed it on 2026-09-05. The
// cohort card survived that cut and was still saying "1,240 Palates eat like
// you · They average 4.7 eating-out meals a week · Most concentrated in:
// Brooklyn, Austin, LA", every line of it generated from a hash of the
// identity's own name. Worse, the branch labelled "real" replaced only the
// count and kept the other three, so the hedge disappeared and the invention
// did not.
//
// The rule now: a cross-user claim needs real rows, or the card does not
// render. This test is what keeps that true.
// ============================================================================

const ROOT = path.resolve(__dirname, "..", "..");

/** A comment explaining why the invention was removed is not an invention. */
function notAComment(line: string): boolean {
  const body = line.split(":").slice(2).join(":").trim();
  return !(body.startsWith("//") || body.startsWith("*") || body.startsWith("/*"));
}

function vector(): TasteVector {
  return {
    visitCount: 12, wishlistCount: 3,
    cuisineRegion: { american: 8, italian: 4 }, cuisineSubregion: { burger: 6 }, cuisineType: { american: 8 },
    cuisineRegionAspirational: {}, cuisineSubregionAspirational: {}, cuisineTypeAspirational: {},
    formatClass: { casual_dining: 9 }, priceTier: { "2": 8 }, chainType: {}, occasion: {}, flavor: {},
    culturalContext: {}, topNeighborhoods: [], neighborhoodLoyalty: 0.4, geographicSpreadKm: 8,
    hourly: new Array(24).fill(0), dowCounts: new Array(7).fill(0),
    weekendShare: 0.3, repeatRate: 0.3, explorationRate: 0.7,
    uniqueRestaurants: 9, averagePriceLevel: 2, priceSpread: 0.5,
    aspirationalGap: 0, aspirationTags: {},
  } as TasteVector;
}

const identity = {
  label: "Late-Night Explorer", secondary: "You try new spots after dark.",
  description: "d", meaning: "m", evidence: ["e"],
} as PalateIdentity;

describe("no fabricated cross-user statistics", () => {
  it("has no hash-seeded cohort generator left in the source", () => {
    const hits = (() => {
      try {
        return execSync(
          `grep -rn --include=*.ts --include=*.tsx -E "generateFakeCohort|Palates eat like you|eating-out meals a week|Most concentrated in" lib app components | grep -v __tests__ || true`,
          { cwd: ROOT, encoding: "utf8" },
        ).split("\n").filter(Boolean).filter(notAComment);
      } catch { return []; }
    })();
    expect(hits).toEqual([]);
  });

  it("never labels a card 'preview' next to a number", () => {
    // The hedge is the smell. If a figure needs the word preview beside it,
    // it is not a figure, and the honest render is nothing at all.
    const hits = (() => {
      try {
        return execSync(
          `grep -rn --include=*.tsx -E '"preview"|· preview' app components | grep -v __tests__ || true`,
          { cwd: ROOT, encoding: "utf8" },
        ).split("\n").filter(Boolean).filter(notAComment);
      } catch { return []; }
    })();
    expect(hits).toEqual([]);
  });

  it("describes your own signals without claiming a rank against anyone", () => {
    const cards = generatePercentileCards(vector(), identity);
    expect(cards.length).toBeGreaterThan(2);
    for (const c of cards) {
      // Qualitative labels on the user's own rate, never "top 12%".
      expect(["Strong", "Notable", "Light"]).toContain(c.headline);
      expect(c.body).not.toMatch(/top \d|percentile|than \d+%|more than most/i);
    }
  });
});
