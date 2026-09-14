import {
  DIGEST_HOUR_BY_WEEKDAY,
  DIGEST_MINUTE,
  digestHourOn,
} from "../passive-digest";

/**
 * The digest hour is a product decision, stated directly: "9pm every night
 * except Saturday and Friday which will be 12:00 am."
 *
 * It had no test. The hour had already been personalised once before — the
 * argument for a fixed time is that a predictable hour is a promise the app
 * can keep, and a learned one is a promise it cannot — so the table is exactly
 * the kind of thing a later refactor "improves" back into a model. These cases
 * are here so that change has to be deliberate.
 *
 * 24 rather than 0 is load-bearing: Date.setHours(24) rolls to 00:00 the NEXT
 * day, so Friday's digest fires Saturday midnight. Writing 0 would fire it at
 * the START of Friday, twenty-one hours early.
 */
const SUN = 0, MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6;

// 2026-09-13 is a Sunday, so these indices line up with real dates.
function dayWithWeekday(weekday: number): Date {
  const d = new Date(2026, 8, 13 + weekday, 12, 0, 0);
  expect(d.getDay()).toBe(weekday);
  return d;
}

describe("the digest fires at the hour that was asked for", () => {
  it.each([
    ["Sunday", SUN, 21],
    ["Monday", MON, 21],
    ["Tuesday", TUE, 21],
    ["Wednesday", WED, 21],
    ["Thursday", THU, 21],
  ])("%s at 9pm", (_name, weekday, hour) => {
    expect(digestHourOn(dayWithWeekday(weekday))).toBe(hour);
  });

  it.each([
    ["Friday", FRI],
    ["Saturday", SAT],
  ])("%s rolls to midnight", (_name, weekday) => {
    expect(digestHourOn(dayWithWeekday(weekday))).toBe(24);
  });

  it("uses 24 rather than 0, so midnight means the END of the night", () => {
    // The distinction is the whole point: 0 would fire at the start of Friday.
    expect(DIGEST_HOUR_BY_WEEKDAY[FRI]).not.toBe(0);
    expect(DIGEST_HOUR_BY_WEEKDAY[SAT]).not.toBe(0);
    const d = new Date(2026, 8, 18, 12, 0, 0); // a Friday
    expect(d.getDay()).toBe(FRI);
    d.setHours(DIGEST_HOUR_BY_WEEKDAY[FRI], DIGEST_MINUTE, 0, 0);
    expect(d.getDay()).toBe(SAT);
    expect(d.getHours()).toBe(0);
  });

  it("fires on the hour", () => {
    expect(DIGEST_MINUTE).toBe(0);
  });

  it("covers all seven days", () => {
    expect(DIGEST_HOUR_BY_WEEKDAY).toHaveLength(7);
  });

  // The pattern argument is deliberately ignored. If it ever starts mattering
  // again, the fixed-hour promise is gone and that should be a visible choice.
  it("ignores any eating pattern handed to it", () => {
    const friday = dayWithWeekday(FRI);
    const wednesday = dayWithWeekday(WED);
    const pattern = { medianDinnerHour: 18 } as never;
    expect(digestHourOn(friday, pattern)).toBe(digestHourOn(friday));
    expect(digestHourOn(wednesday, pattern)).toBe(digestHourOn(wednesday));
    expect(digestHourOn(wednesday, null)).toBe(21);
  });
});
