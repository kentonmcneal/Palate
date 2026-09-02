import {
  FONT_CAP,
  STACK_THRESHOLD,
  DECLUTTER_THRESHOLD,
  scaleSpace,
} from "../a11y";

// Reported by a tester's mother running a large iPhone text size. The rules
// below are the contract; a future edit that quietly tightens a cap until the
// design "looks right again" should fail here, because that fix is just
// disabling accessibility.
describe("font scale caps", () => {
  it("never caps chrome so tightly that the setting stops working", () => {
    for (const [role, cap] of Object.entries(FONT_CAP)) {
      expect({ role, cap }).toMatchObject({ cap: expect.any(Number) });
      expect(cap).toBeGreaterThanOrEqual(1.2);
    }
  });

  it("gives the tab bar the tightest budget — five labels on a fixed bar", () => {
    expect(FONT_CAP.tabBar).toBeLessThanOrEqual(FONT_CAP.chrome);
    expect(FONT_CAP.chrome).toBeLessThanOrEqual(FONT_CAP.eyebrow);
  });

  it("stacks before it declutters — reflow first, drop ornament later", () => {
    expect(STACK_THRESHOLD).toBeLessThan(DECLUTTER_THRESHOLD);
  });
});

describe("scaleSpace", () => {
  it("grows a control with its label", () => {
    expect(scaleSpace(52, 1)).toBe(52);
    expect(scaleSpace(52, 1.5)).toBe(78);
  });

  it("stops growing at the ceiling so a control can't eat the screen", () => {
    // iOS goes to ~3.1x; a 52pt button must not become a 161pt one.
    expect(scaleSpace(52, 3.1)).toBe(scaleSpace(52, 1.6));
    expect(scaleSpace(84, 3.1, FONT_CAP.tabBar)).toBe(101);
  });

  it("treats a missing or 1x scale as no change", () => {
    expect(scaleSpace(36, 1)).toBe(36);
  });
});
