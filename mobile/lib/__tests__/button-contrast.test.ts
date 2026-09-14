import fs from "fs";
import path from "path";
import { contrastRatio } from "../contrast";
import { colors } from "../../theme";

const ROOT = path.resolve(__dirname, "..", "..");

// ----------------------------------------------------------------------------
// White text needs 4.5:1. The brand red is 4.09.
// ----------------------------------------------------------------------------
// Measured, not guessed: #E0473C against white is 4.09:1, so every primary
// button in the app failed WCAG AA for normal text. theme.ts already carried
// #C13A2F at 5.37:1 and documented it for exactly this, and nothing used it as
// a FILL.
//
// `red` deliberately stays 4.09 for fills that carry no text — the heart, the
// flame, a checked box — where the rule is 3:1 and it clears comfortably.
// Darkening the brand everywhere to fix a text problem would be a design
// decision, not a bug fix.
// ----------------------------------------------------------------------------
describe("white labels sit on an accessible red", () => {
  it("primaryFill passes AA against white text", () => {
    expect(contrastRatio("#FFFFFF", colors.primaryFill)).toBeGreaterThanOrEqual(4.5);
  });

  it("records that the brand red does NOT, so nobody repoints a label at it", () => {
    expect(contrastRatio("#FFFFFF", colors.red)).toBeLessThan(4.5);
    // ...but it is fine for non-text, which is why it stays.
    expect(contrastRatio("#FFFFFF", colors.red)).toBeGreaterThanOrEqual(3);
  });

  it("the shared Button's primary variant uses the accessible fill", () => {
    const src = fs.readFileSync(path.join(ROOT, "components/Button.tsx"), "utf8");
    expect(src).toMatch(/primary:\s*\{\s*backgroundColor:\s*colors\.primaryFill\s*\}/);
  });

  it("redText is still the token for red TEXT on a light ground", () => {
    expect(contrastRatio("#FFFFFF", colors.redText)).toBeGreaterThanOrEqual(4.5);
  });
});
