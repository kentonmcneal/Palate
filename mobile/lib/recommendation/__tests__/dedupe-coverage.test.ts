import fs from "fs";
import path from "path";

// ============================================================================
// Every ranked surface dedupes venues. One screen fixing it is not a fix.
// ----------------------------------------------------------------------------
// Google lists one venue twice under different place ids ("Hong Kong
// Restaurant" and "Hong Kong Restaurant | Chinese"). dedupeVenues was written
// when a tester reported the duplicate rows, and it was applied to Discover
// and to the shared candidate pool — but not to Home's list, not to the Home
// hero, and not to featured lists. The bug was reported once and fixed on one
// screen, which is the same mistake the Wrapped copy made.
//
// Search is deliberately NOT on this list: somebody typing a restaurant's name
// should see every listing that matches it, including the twin. Collapsing
// results there hides the thing they asked for.
// ============================================================================

const ROOT = path.resolve(__dirname, "..", "..", "..");

const RANKED_SURFACES = [
  "components/RecommendationsCard.tsx",
  "app/(tabs)/discover.tsx",
  "lib/featured-lists.ts",
  "lib/recommendation/candidates.ts",
];

// components/RightNowHero.tsx is NOT on that list and must not be: it is
// rendered nowhere. It was removed from Home on purpose, because it and the
// first ranked pick were repeatedly the same restaurant, and the file was left
// behind. Listing it here would have made this suite assert coverage of a
// screen nobody sees, which is a worse kind of green than a missing test.

/** Files that build a pool for SEARCH, where collapsing is wrong. */
const EXEMPT = ["lib/cuisine-catalogue.ts"];

describe("venue dedupe covers every ranked surface", () => {
  it.each(RANKED_SURFACES)("%s pipes filterRecommendable through dedupeVenues", (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    expect(src).toContain("filterRecommendable");
    expect(src).toContain("dedupeVenues");
    // Not merely imported: actually wrapped around the eligibility filter.
    expect(src).toMatch(/dedupeVenues\(\s*filterRecommendable/);
  });

  it("leaves search alone, so typing a name still finds every listing", () => {
    for (const rel of EXEMPT) {
      expect(fs.readFileSync(path.join(ROOT, rel), "utf8")).not.toContain("dedupeVenues");
    }
  });

  it("only claims surfaces that are actually rendered", () => {
    // If RightNowHero is ever brought back, this fails and someone has to
    // decide whether it belongs on the list above.
    const app = fs.readFileSync(path.join(ROOT, "app/(tabs)/index.tsx"), "utf8");
    const rendered = /<RightNowHero[\s/>]/.test(app);
    expect(rendered).toBe(false);
  });

  it("names surfaces that exist, so a rename cannot empty this suite", () => {
    for (const rel of [...RANKED_SURFACES, ...EXEMPT]) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
    }
  });
});
