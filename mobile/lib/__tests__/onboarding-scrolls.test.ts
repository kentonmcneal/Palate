import fs from "fs";
import path from "path";

/**
 * Every full-screen onboarding step must scroll.
 *
 * These screens are a column with the copy on top and the only button at the
 * bottom. A plain View does not scroll, and RN's Yoga default is
 * flexShrink: 0, so when the copy grows the footer is pushed off-screen rather
 * than compressed. At one notch above default on the ordinary Display & Text
 * Size slider — no accessibility setting involved — both buttons were entirely
 * below the visible edge on SE, 13 mini and iPhone 15. Around a third of iOS
 * users run larger-than-default text, and these steps are mandatory, so the
 * failure lands before anyone has an account.
 *
 * The fix pattern is passive-capture-intro's: the body scrolls,
 * the CTA sits OUTSIDE the scroller so it is always reachable.
 */
const SCREENS = [
  "app/onboarding/welcome.tsx",
  "app/onboarding/profile-setup.tsx",
  "app/onboarding/why-location.tsx",
  "app/onboarding/permission.tsx",
  "app/onboarding/privacy.tsx",
  "app/claim-username.tsx",
  "app/passive-capture-intro.tsx",
];

const ROOT = path.resolve(__dirname, "../..");

/**
 * Strip COMMENTS ONLY before matching.
 *
 * A guard that trips on its own documentation is a guard nobody keeps: this
 * file and every screen it checks explain the bug in prose containing the very
 * phrases being searched for, so the comments have to go.
 *
 * String literals must NOT be stripped, which the first version of this
 * function did. `justifyContent: "space-between"` IS a string literal, so
 * blanking strings turned the offending line into `justifyContent: ""` and the
 * guard passed cheerfully with the bug reintroduced. Verified by putting the
 * bug back and watching it fail.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("onboarding screens scroll", () => {
  for (const rel of SCREENS) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const c = code(src);

    it(`${rel} renders a ScrollView`, () => {
      expect(c).toMatch(/<ScrollView/);
    });

    // The regression that caused this: space-between on a non-scrolling root
    // pins the footer to the bottom edge and lets the body overflow past it.
    it(`${rel} does not pin a footer with space-between outside a scroller`, () => {
      const offenders = c.match(/justifyContent:\s*[""']?space-between/g) ?? [];
      expect(offenders).toHaveLength(0);
    });

    it(`${rel} keeps its CTA outside the ScrollView`, () => {
      const close = c.lastIndexOf("</ScrollView>");
      const cta = c.lastIndexOf("styles.cta");
      // A screen with no styles.cta footer is fine; if it has one it must come
      // after the scroller closes.
      if (cta !== -1) expect(cta).toBeGreaterThan(close);
    });
  }
});
