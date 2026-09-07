import fs from "fs";
import path from "path";
import { contrastRatio, luminance, WCAG } from "../contrast";
import { palateGradients } from "../theme/palateTheme";

// ============================================================================
// The Wrapped story is the screen strangers see. It has to be readable.
// ----------------------------------------------------------------------------
// The hero headline was bright red on the storyRed gradient, whose lightest
// stop is #5A0B14. That is about 3.6:1 — enough to pass the large-text rule
// and not enough to read on a phone, which the founder saw in a screenshot in
// seconds and I did not, having never looked at the screen.
//
// So the question is answered by arithmetic now rather than by eye, because
// mine is not available.
// ============================================================================

const ROOT = path.resolve(__dirname, "..", "..");
const story = fs.readFileSync(path.join(ROOT, "app", "wrapped-story.tsx"), "utf8");

/** The lightest stop of a gradient is the hardest background to sit on. */
function lightestStop(stops: readonly string[]): string {
  return [...stops].sort((a, b) => luminance(b) - luminance(a))[0];
}

describe("the story panels are legible", () => {
  it("computes a ratio the way WCAG does", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("puts white on the red panel, well past the body threshold", () => {
    const bg = lightestStop(palateGradients.storyRed);
    expect(contrastRatio("#ffffff", bg)).toBeGreaterThan(WCAG.body * 2);
  });

  it("records why the old colour failed, so it is not reintroduced as a nicety", () => {
    const bg = lightestStop(palateGradients.storyRed);
    // The bright red the headline used to be.
    const ratio = contrastRatio("#FF2D16", bg);
    expect(ratio).toBeLessThan(WCAG.body);
    expect(ratio).toBeGreaterThan(WCAG.large); // passed the letter of the rule
  });

  it("keeps the hero headline white in the source", () => {
    const hero = story.slice(story.indexOf("headlineHero:"), story.indexOf("headlineHero:") + 700);
    expect(hero).toMatch(/color:\s*"#fff"/);
    expect(hero).not.toMatch(/color:\s*palateColors\.red/);
  });

  it("keeps the dark panels readable too", () => {
    const bg = lightestStop(palateGradients.storyDark);
    expect(contrastRatio("#ffffff", bg)).toBeGreaterThan(WCAG.body);
  });
});
