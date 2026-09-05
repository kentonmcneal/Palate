import { visitPayoff, type VisitFacts } from "../visit-payoff";

const base: VisitFacts = {
  totalVisits: 10,
  visitsHere: 1,
  cuisine: "italian",
  cuisineVisits30d: 1,
  distinctPlaces: 8,
  visitsToWrapped: 0,
  becameTopSpot: false,
};

const f = (over: Partial<VisitFacts> = {}): VisitFacts => ({ ...base, ...over });

// A fake payoff is worse than none: it teaches people the app's observations
// are decorative. So the rules are that every line must be TRUE of the facts
// given, and that null is an acceptable — often correct — answer.

describe("visitPayoff", () => {
  it("marks a genuine first visit, and only the first", () => {
    expect(visitPayoff(f({ totalVisits: 1, distinctPlaces: 1 })))
      .toBe("That's your first. Your palate starts here.");
    expect(visitPayoff(f({ totalVisits: 2 })))
      .not.toMatch(/first/i);
  });

  it("leads with a changed favourite — the most interesting thing available", () => {
    expect(visitPayoff(f({ becameTopSpot: true, visitsHere: 4, cuisineVisits30d: 9 })))
      .toBe("That just became your most-visited place.");
  });

  it("does not announce a new top spot on a first-ever visit there", () => {
    // becameTopSpot can be true with visitsHere === 1 when everything else is
    // also 1; calling that a change would be noise.
    expect(visitPayoff(f({ becameTopSpot: true, visitsHere: 1 })))
      .not.toMatch(/most-visited/);
  });

  it("counts repeats correctly, with real ordinals", () => {
    expect(visitPayoff(f({ visitsHere: 2 }))).toBe("Second time here.");
    expect(visitPayoff(f({ visitsHere: 3 }))).toBe("3rd time here. You're a regular.");
    expect(visitPayoff(f({ visitsHere: 4 }))).toBe("4th time here. You're a regular.");
    expect(visitPayoff(f({ visitsHere: 21 }))).toBe("21st time here. You're a regular.");
    expect(visitPayoff(f({ visitsHere: 11 }))).toBe("11th time here. You're a regular.");
  });

  it("surfaces a cuisine pattern the person may not have noticed", () => {
    expect(visitPayoff(f({ cuisine: "thai", cuisineVisits30d: 4 })))
      .toBe("That's 4 Thai meals this month.");
  });

  it("humanizes a classifier slug rather than printing it raw", () => {
    expect(visitPayoff(f({ cuisine: "fast_casual", cuisineVisits30d: 3 })))
      .toBe("That's 3 Fast Casual meals this month.");
  });

  it("nudges toward Wrapped only when it is genuinely close", () => {
    expect(visitPayoff(f({ visitsToWrapped: 1 })))
      .toBe("One more and your Wrapped unlocks.");
    expect(visitPayoff(f({ visitsToWrapped: 2 })))
      .toBe("2 more and your Wrapped unlocks.");
    // Five away is not a nudge, it is a chore.
    expect(visitPayoff(f({ visitsToWrapped: 5 }))).not.toMatch(/Wrapped/);
    // And never nudge toward something already unlocked.
    expect(visitPayoff(f({ visitsToWrapped: 0 }))).not.toMatch(/Wrapped/);
  });

  it("says nothing rather than reaching for filler", () => {
    expect(visitPayoff(f({
      totalVisits: 40, visitsHere: 1, cuisine: null, cuisineVisits30d: 1,
      distinctPlaces: 1, visitsToWrapped: 0,
    }))).toBeNull();
  });

  it("never claims a first when it is not one", () => {
    for (let n = 2; n <= 6; n++) {
      expect(visitPayoff(f({ totalVisits: n }))).not.toMatch(/your first/i);
    }
  });
});
