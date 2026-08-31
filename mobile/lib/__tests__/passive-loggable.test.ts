import { isLoggableVenue } from "../passive-pipeline";
import type { Restaurant } from "../places";

function venue(eligibility: number | null, reason: string | null = null): Restaurant {
  return {
    google_place_id: "x",
    name: "x",
    recommendation_eligibility: eligibility,
    ineligibility_reason: reason,
  } as Restaurant;
}

describe("isLoggableVenue", () => {
  it("keeps ordinary recommendable restaurants", () => {
    expect(isLoggableVenue(venue(1))).toBe(true);
    expect(isLoggableVenue(venue(0.7, "regional_chain"))).toBe(true);
  });

  // The bug this function exists to fix: you eat at Shake Shack, and a food
  // diary that refuses to log it is broken. Eligibility 0 means "don't
  // recommend", not "didn't happen".
  it("keeps fast food and national chains", () => {
    expect(isLoggableVenue(venue(0, "fast_food"))).toBe(true);
    expect(isLoggableVenue(venue(0, "national_chain"))).toBe(true);
  });

  it("keeps food courts and bars — people eat there", () => {
    expect(isLoggableVenue(venue(0, "food_court"))).toBe(true);
    expect(isLoggableVenue(venue(0, "nightlife"))).toBe(true);
    expect(isLoggableVenue(venue(0, "lounge_nightlife"))).toBe(true);
  });

  it("still drops venues that are not food at all", () => {
    expect(isLoggableVenue(venue(0, "not_a_food_venue"))).toBe(false);
    expect(isLoggableVenue(venue(0, "not_a_restaurant"))).toBe(false);
    expect(isLoggableVenue(venue(0, "non_food_primary_type"))).toBe(false);
    expect(isLoggableVenue(venue(0, "event_venue"))).toBe(false);
  });

  it("drops captive venues, where a stop is transit or a stay rather than a meal", () => {
    expect(isLoggableVenue(venue(0, "airport"))).toBe(false);
    expect(isLoggableVenue(venue(0, "captive_venue"))).toBe(false);
    expect(isLoggableVenue(venue(0, "lounge_gated"))).toBe(false);
    expect(isLoggableVenue(venue(0, "hotel"))).toBe(false);
    expect(isLoggableVenue(venue(0, "hotel_generic"))).toBe(false);
  });

  it("drops a hard-rejected venue whose reason was not recorded", () => {
    // Unknown provenance: the classifier rejected it outright and we cannot
    // tell whether eating was plausible.
    expect(isLoggableVenue(venue(0, null))).toBe(false);
  });

  it("treats a missing eligibility as loggable", () => {
    // Older cached rows predate the classifier; they should not vanish.
    expect(isLoggableVenue(venue(null))).toBe(true);
  });
});
