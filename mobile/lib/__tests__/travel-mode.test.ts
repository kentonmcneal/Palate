import {
  isAwayFromKnownAreas, minDwellFor, clusterHitsFor,
} from "../passive-pipeline";

// ============================================================================
// Away from home, passive capture had nothing to suppress against.
// ----------------------------------------------------------------------------
// Home/work suppression is learned from clusters of places somebody returns to.
// Leave the city and there are no clusters within range, so the check returns
// false for every stop and nothing is filtered — at precisely the moment volume
// explodes, because everything is unfamiliar.
//
// Measured on the founder's week away: 987 detections in seven days, 7 logged
// visits, and one restaurant near where he stayed resolved 24 times. The
// detector was working. It had nothing to work with.
// ============================================================================

const MEMPHIS = { lat: 35.1495, lng: -90.0490 };
const NEW_YORK = { lat: 40.7440, lng: -73.9970 };   // Chelsea
const ACROSS_MEMPHIS = { lat: 35.0980, lng: -89.8410 }; // ~20km, same city

const pt = (lat: number, lng: number) => ({ lat, lng, hour: 23, weekday: true, dwellMin: 480 });

describe("recognising that somebody is travelling", () => {
  it("says away when every known place is a different city", () => {
    expect(isAwayFromKnownAreas(NEW_YORK.lat, NEW_YORK.lng, [pt(MEMPHIS.lat, MEMPHIS.lng)])).toBe(true);
  });

  it("does not say away for the other side of the same city", () => {
    // The whole point of a 50km radius: a cross-town dinner is not a trip, and
    // treating it as one would hold ordinary meals to the stricter bar.
    expect(isAwayFromKnownAreas(ACROSS_MEMPHIS.lat, ACROSS_MEMPHIS.lng, [pt(MEMPHIS.lat, MEMPHIS.lng)])).toBe(false);
  });

  it("says NOT away when there is no history at all", () => {
    // A brand-new account is not travelling, it is new. Holding it to the
    // stricter bar would hide the first real meals it ever sees, which are the
    // ones that decide whether anybody keeps the app.
    expect(isAwayFromKnownAreas(NEW_YORK.lat, NEW_YORK.lng, [])).toBe(false);
  });

  it("needs only one known place in range to count as home territory", () => {
    const history = [pt(MEMPHIS.lat, MEMPHIS.lng), pt(NEW_YORK.lat, NEW_YORK.lng)];
    expect(isAwayFromKnownAreas(NEW_YORK.lat, NEW_YORK.lng, history)).toBe(false);
  });
});

describe("what changes once away", () => {
  it("raises the dwell floor, because five minutes is how long a queue takes", () => {
    expect(minDwellFor(true)).toBeGreaterThan(minDwellFor(false));
  });

  it("keeps the ordinary floor at home, so nothing regresses for normal weeks", () => {
    expect(minDwellFor(false)).toBe(5);
  });

  it("LOWERS the bar for learning where you are sleeping", () => {
    // The two move in opposite directions on purpose. A hotel has to be
    // recognised in two nights or the trip ends before suppression starts.
    expect(clusterHitsFor(true)).toBeLessThan(clusterHitsFor(false));
    expect(clusterHitsFor(true)).toBe(2);
  });
});
