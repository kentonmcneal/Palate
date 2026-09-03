import { isOpenAt, venueOpenAt, type OpeningPeriod } from "../opening-hours";

// Google days: 0 = Sunday ... 6 = Saturday.
const MON = 1, FRI = 5, SAT = 6, SUN = 0;

function period(od: number, oh: number, cd: number, ch: number): OpeningPeriod {
  return { open: { day: od, hour: oh, minute: 0 }, close: { day: cd, hour: ch, minute: 0 } };
}

/** A date with a known weekday. 2026-08-31 is a Monday. */
function on(day: number, hour: number, minute = 0): Date {
  const monday = new Date(2026, 7, 31, hour, minute);
  return new Date(monday.getTime() + ((day - 1) * 24 * 60 * 60 * 1000));
}

describe("isOpenAt", () => {
  it("returns null when there is no data, so unknown is never mistaken for closed", () => {
    // Penalising a venue for missing hours would punish exactly the small
    // independent places this product exists to surface.
    expect(isOpenAt(null, on(MON, 12))).toBeNull();
    expect(isOpenAt(undefined, on(MON, 12))).toBeNull();
    expect(isOpenAt([], on(MON, 12))).toBeNull();
  });

  it("handles an ordinary daytime window", () => {
    const hours = [period(MON, 11, MON, 22)];
    expect(isOpenAt(hours, on(MON, 12))).toBe(true);
    expect(isOpenAt(hours, on(MON, 10, 59))).toBe(false);
    expect(isOpenAt(hours, on(MON, 22))).toBe(false); // closing time is exclusive
  });

  it("handles a period crossing midnight", () => {
    // Open Friday 17:00, closes Saturday 02:00 — the late dinners we most want
    // to attribute correctly.
    const hours = [period(FRI, 17, SAT, 2)];
    expect(isOpenAt(hours, on(FRI, 23))).toBe(true);
    expect(isOpenAt(hours, on(SAT, 1))).toBe(true);
    expect(isOpenAt(hours, on(SAT, 3))).toBe(false);
  });

  it("handles a period wrapping the week boundary", () => {
    // Saturday night into Sunday morning wraps past the end of the week.
    const hours = [period(SAT, 20, SUN, 3)];
    expect(isOpenAt(hours, on(SAT, 23))).toBe(true);
    expect(isOpenAt(hours, on(SUN, 2))).toBe(true);
    expect(isOpenAt(hours, on(SUN, 4))).toBe(false);
  });

  it("treats a period with no close as open 24 hours", () => {
    expect(isOpenAt([{ open: { day: MON, hour: 0, minute: 0 } }], on(MON, 3))).toBe(true);
  });

  it("checks every period, not just the first", () => {
    // Split shift: lunch, then dinner, with an afternoon gap.
    const hours = [period(MON, 11, MON, 14), period(MON, 17, MON, 22)];
    expect(isOpenAt(hours, on(MON, 12))).toBe(true);
    expect(isOpenAt(hours, on(MON, 15))).toBe(false);
    expect(isOpenAt(hours, on(MON, 19))).toBe(true);
  });

  it("returns null rather than false when every period is malformed", () => {
    // Unparseable data is still an absence of information.
    expect(isOpenAt([{ close: { day: 1, hour: 5 } } as OpeningPeriod], on(MON, 12))).toBeNull();
  });

  it("reports closed on a day with no period at all", () => {
    expect(isOpenAt([period(MON, 11, MON, 22)], on(SUN, 12))).toBe(false);
  });
});

describe("venueOpenAt", () => {
  it("passes through an array and rejects anything else", () => {
    expect(venueOpenAt([period(MON, 11, MON, 22)], on(MON, 12))).toBe(true);
    expect(venueOpenAt(null, on(MON, 12))).toBeNull();
    expect(venueOpenAt({ periods: [] }, on(MON, 12))).toBeNull();
  });
});
