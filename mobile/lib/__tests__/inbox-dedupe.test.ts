import { isSameMeal, localDayKey } from "../passive-confirm";

const at = (h: number, m = 0, day = 12) => new Date(2026, 8, day, h, m).getTime();

// ----------------------------------------------------------------------------
// One meal, one prompt.
// ----------------------------------------------------------------------------
// The dedupe window was one hour, and an hour is shorter than a meal. iOS
// emits a fresh stop every time the location settles again, so a long dinner —
// or stepping out to the car and back — produced another entry and another
// prompt. Measured on live data: one place resolved TWELVE times for one user
// in one day, across 74 (user, place, day) triples.
// ----------------------------------------------------------------------------
describe("inbox dedupe", () => {
  const A = "place-a";
  const B = "place-b";

  it("treats two stops three hours apart at one place as one meal", () => {
    // The case the one-hour window missed, and the reason for the change.
    expect(isSameMeal({ place_id: A, detectedAt: at(18) }, { place_id: A, detectedAt: at(21) })).toBe(true);
  });

  it("still collapses stops within the hour", () => {
    expect(isSameMeal({ place_id: A, detectedAt: at(19) }, { place_id: A, detectedAt: at(19, 40) })).toBe(true);
  });

  it("keeps different places on the same day apart", () => {
    expect(isSameMeal({ place_id: A, detectedAt: at(13) }, { place_id: B, detectedAt: at(19) })).toBe(false);
  });

  it("does not merge the same place across a midnight", () => {
    // 11:30pm and 00:30 are ninety minutes apart but they are two days, and a
    // late dinner must not swallow the next day's lunch at the same spot.
    const late = new Date(2026, 8, 12, 23, 30).getTime();
    const early = new Date(2026, 8, 13, 0, 30).getTime();
    expect(isSameMeal({ place_id: A, detectedAt: late }, { place_id: A, detectedAt: early })).toBe(false);
  });

  it("keys the day in LOCAL time, not UTC", () => {
    // A 7pm dinner and a 9pm dessert are the same local day everywhere. Under
    // a UTC key they split for anyone far enough west, which is the same class
    // of bug as the Wrapped and leaderboard week boundaries.
    expect(localDayKey(at(19))).toBe(localDayKey(at(21)));
    expect(localDayKey(at(19))).not.toBe(localDayKey(at(19, 0, 13)));
  });
});
