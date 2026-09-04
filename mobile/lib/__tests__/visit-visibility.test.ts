import { defaultVisitVisibility, visibilityReasonLabel } from "../visit-visibility";
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
