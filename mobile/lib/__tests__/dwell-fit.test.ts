import { dwellFit, DWELL_FIT_FLOOR } from "../passive-confidence";
import { rankCandidates } from "../passive-pipeline";

const sonic = {
  google_place_id: "sonic",
  name: "Sonic Drive-In",
  primary_type: "fast_food_restaurant",
  types: ["fast_food_restaurant", "restaurant", "food"],
  format_class: "quick_service",
  user_rating_count: 1346,
} as never;

const chinaTaste = {
  google_place_id: "china",
  name: "China Taste",
  primary_type: "restaurant",
  types: ["restaurant", "food"],
  format_class: "casual_dining",
  user_rating_count: 62,
} as never;

// ----------------------------------------------------------------------------
// The Winchester Road tie.
// ----------------------------------------------------------------------------
// A real 25-minute stop resolved to Sonic Drive-In (52m away, 1,346 reviews)
// instead of China Taste, the sit-down place the person actually ate at (62
// reviews). Accuracy was 34m, so POSITION could never separate them.
//
// Dwell could. Twenty-five minutes at a drive-through is barely plausible;
// twenty-five minutes at a sit-down restaurant is just dinner. dwellScore()
// was a pure function of minutes and knew nothing about the venue, so the one
// discriminating signal in the data was thrown away.
// ----------------------------------------------------------------------------
describe("dwell fits the kind of venue", () => {
  it("a 25-minute dinner suits a sit-down restaurant", () => {
    expect(dwellFit(25, chinaTaste)).toBe(1);
  });

  it("a 25-minute stop does not suit a drive-through", () => {
    expect(dwellFit(25, sonic)).toBeLessThan(1);
  });

  // The real Winchester Road coordinates, 52m apart. GPS accuracy that evening
  // was 34m, so no ranker will ever separate these two on position.
  // The MIDPOINT, not either door. A 34m fix between venues 52m apart cannot
  // tell you which side you are on, and a test that puts the stop on the right
  // answer's doorstep proves nothing.
  const STOP = { lat: 35.051125, lng: -89.81491 };
  const withCoords = (p: never, lat: number, lng: number) =>
    ({ ...(p as object), latitude: lat, longitude: lng } as never);
  const SONIC = withCoords(sonic, 35.05109, -89.81463);
  const CHINA = withCoords(chinaTaste, 35.05116, -89.81519);

  it("a 25-minute stop picks the sit-down place, not the drive-through", () => {
    const ranked = rankCandidates(STOP, [SONIC, CHINA], { hour: 20, dwellMin: 25 });
    expect(ranked[0].name).toBe("China Taste");
  });

  it("and a four-minute stop still picks the drive-through", () => {
    // The fix must not simply always favour sit-down places: a genuine
    // drive-through run is short, and that should read as Sonic.
    const ranked = rankCandidates(STOP, [SONIC, CHINA], { hour: 20, dwellMin: 4 });
    expect(ranked[0].name).toBe("Sonic Drive-In");
  });

  it("without a dwell, it has no opinion and popularity decides as before", () => {
    const ranked = rankCandidates(STOP, [SONIC, CHINA], { hour: 20 });
    expect(ranked).toHaveLength(2);
  });

  it("never zeroes the evidence", () => {
    // Somebody can sit in a Sonic car park for an hour. This is a tiebreaker,
    // not a rule about how people are allowed to eat.
    expect(dwellFit(240, sonic)).toBeGreaterThanOrEqual(DWELL_FIT_FLOOR);
  });

  it("says nothing when the format is unknown", () => {
    const unknown = { google_place_id: "x", name: "X", types: [] } as never;
    expect(dwellFit(25, unknown)).toBe(1);
  });
});
