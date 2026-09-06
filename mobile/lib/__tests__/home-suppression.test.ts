import { spansOvernight, isWorkHours } from "../passive-pipeline";

// ============================================================================
// Home/work suppression, measured against real telemetry.
// ----------------------------------------------------------------------------
// Across 668 detections in 30 days, `home-work-suppressed` fired ZERO times,
// while 92 stops came back no-venue-found with GPS accuracy between 4 and 27
// metres. Excellent accuracy and no restaurant is what somebody's flat looks
// like. The cause was that overnight was tested on the ARRIVAL HOUR, and
// nobody arrives home at 2am — you get in at seven and leave at eight, so the
// recorded hour was 19: not overnight, not work hours, no evidence either way.
// ============================================================================

describe("spansOvernight", () => {
  it("recognises the ordinary shape of being home", () => {
    // In at 7pm, out at 8am the next day.
    expect(spansOvernight(19, 13 * 60)).toBe(true);
  });

  it("recognises a late arrival too", () => {
    expect(spansOvernight(23, 8 * 60)).toBe(true);
    expect(spansOvernight(1, 6 * 60)).toBe(true);
  });

  it("does not call a long dinner overnight", () => {
    // 7pm to 10pm is a good dinner, not a bed.
    expect(spansOvernight(19, 3 * 60)).toBe(false);
  });

  it("does not call a full working day overnight", () => {
    expect(spansOvernight(9, 8 * 60)).toBe(false);
  });

  it("falls back to the arrival instant for a point with no dwell", () => {
    // Points written before dwell was recorded, and open visits.
    expect(spansOvernight(23, 0)).toBe(true);
    expect(spansOvernight(3, 0)).toBe(true);
    expect(spansOvernight(19, 0)).toBe(false);
  });

  it("cannot loop forever on an absurd dwell", () => {
    expect(spansOvernight(12, 60 * 24 * 30)).toBe(true);
  });
});

describe("isWorkHours", () => {
  it("still carves lunch out, so a weekday regular is not read as an office", () => {
    expect(isWorkHours(12, true)).toBe(false);
    expect(isWorkHours(13, true)).toBe(false);
    expect(isWorkHours(10, true)).toBe(true);
    expect(isWorkHours(16, true)).toBe(true);
  });

  it("is never true at the weekend", () => {
    expect(isWorkHours(10, false)).toBe(false);
  });
});
