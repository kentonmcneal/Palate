import { visitPayoff, type VisitFacts, cuisineShare } from "../visit-payoff";

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

// ============================================================================
// The share line — the founder's own example of what a confirm should say.
// ============================================================================
describe("cuisine share of the whole palate", () => {
  const f = {
    totalVisits: 40, visitsHere: 1, cuisine: "italian",
    cuisineVisits30d: 1, cuisineVisitsAll: 12, distinctPlaces: 1,
    visitsToWrapped: 0, becameTopSpot: false,
  };

  it("computes the movement exactly, from the after-state", () => {
    // 11/39 = 28.2% before, 12/40 = 30% after.
    const s = cuisineShare(f)!;
    expect(s.after).toBe(30);
    expect(s.points).toBe(2);
  });

  it("says it, when nothing more interesting is true", () => {
    expect(visitPayoff(f)).toBe("Italian is now 30% of your palate, up 2.");
  });

  it("does not invent a rise that did not happen", () => {
    // 34/40 = 85%, 33/39 = 84.6% — rounds to no movement.
    const flat = { ...f, cuisineVisitsAll: 34 };
    expect(visitPayoff(flat)).toBe("Italian holds at 85% of your palate.");
  });

  it("still lets the more interesting facts win", () => {
    expect(visitPayoff({ ...f, becameTopSpot: true, visitsHere: 3 }))
      .toBe("That just became your most-visited place.");
    expect(visitPayoff({ ...f, visitsHere: 2 })).toBe("Second time here.");
  });

  it("has no before to compare against on the first visit ever", () => {
    expect(cuisineShare({ ...f, totalVisits: 1, cuisineVisitsAll: 1 })).toBeNull();
  });

  it("calls a first-ever cuisine what it is, rather than a percentage", () => {
    expect(visitPayoff({ ...f, cuisineVisitsAll: 1 })).toBe("Your first Italian. That's new.");
  });

  it("stays silent on a sliver rather than manufacturing progress", () => {
    // 2 of 200 is 1%. "Up 1" there is noise dressed as an achievement.
    expect(visitPayoff({
      ...f, totalVisits: 200, cuisineVisitsAll: 2, distinctPlaces: 1, cuisineVisits30d: 1,
    })).toBeNull();
  });
});
