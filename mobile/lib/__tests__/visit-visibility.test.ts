import { defaultVisitVisibility, visibilityReasonLabel, visibilityStateLabel } from "../visit-visibility";
import type { Restaurant } from "../places";

const place = (p: Partial<Restaurant>) => ({ google_place_id: "x", name: "x", ...p } as Restaurant);

describe("defaultVisitVisibility", () => {
  // The private ledger is always complete. This only decides what starts on
  // the PUBLIC profile before the user curates.
  it("hides routine stops", () => {
    expect(defaultVisitVisibility(place({ primary_type: "coffee_shop" })).isPublic).toBe(false);
    expect(defaultVisitVisibility(place({ primary_type: "fast_food_restaurant" })).isPublic).toBe(false);
  });

  it("hides chains", () => {
    expect(defaultVisitVisibility(place({ chain_name: "Chipotle" })).isPublic).toBe(false);
  });

  it("shows an ordinary independent restaurant", () => {
    expect(defaultVisitVisibility(place({ primary_type: "restaurant" })).isPublic).toBe(true);
  });

  it("shows rather than hides when it knows nothing", () => {
    // An unknown venue is more likely a real meal than a coffee run, and a
    // wrongly hidden visit is invisible to the user who would have shared it.
    expect(defaultVisitVisibility(null).isPublic).toBe(true);
    expect(defaultVisitVisibility(place({})).isPublic).toBe(true);
  });

  it("explains itself", () => {
    const r = defaultVisitVisibility(place({ chain_name: "Starbucks" }));
    expect(visibilityReasonLabel(r.reason)).toMatch(/chain/i);
    expect(visibilityReasonLabel("default")).toMatch(/shown/i);
  });
});

// ----------------------------------------------------------------------------
// The bug a tester found: the row said "Shown on your profile" under a header
// reading "0 OF 2 SHOWN", with the switch off.
//
// The old assertions (/chain/i, /shown/i) matched the broken strings just as
// happily as the fixed ones, so they were never going to catch it. These check
// the thing that was actually wrong: the reason clause must not make a claim
// about current state, and the composed line must agree with the switch.
// ----------------------------------------------------------------------------
describe("the row never contradicts its own switch", () => {
  const REASONS = ["routine", "chain", "default"] as const;

  it("reason labels describe the default, never the current state", () => {
    for (const r of REASONS) {
      const label = visibilityReasonLabel(r);
      expect(label).not.toMatch(/on your profile/i);
      expect(label).not.toMatch(/from your profile/i);
      expect(label).toMatch(/by default/i);
    }
  });

  it("state labels say what is true right now", () => {
    expect(visibilityStateLabel(true)).toMatch(/^Shown/);
    expect(visibilityStateLabel(false)).toMatch(/^Hidden/);
  });

  it("a hidden visit reads as hidden even when the default was to show it", () => {
    // Exactly the screenshot: toggle off, default would have shown it.
    const line = `${visibilityStateLabel(false)} · ${visibilityReasonLabel("default")}`;
    expect(line).toMatch(/^Hidden from your profile/);
    expect(line).not.toMatch(/^Shown/);
  });

  it("a shown visit reads as shown even when it is a routine stop", () => {
    // The other screenshot: toggle on, routine stop.
    const line = `${visibilityStateLabel(true)} · ${visibilityReasonLabel("routine")}`;
    expect(line).toMatch(/^Shown on your profile/);
    expect(line).toContain("routine stops are hidden by default");
  });
});
