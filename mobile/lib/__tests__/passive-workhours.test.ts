import { isWorkHours } from "../passive-pipeline";

describe("isWorkHours", () => {
  // The bug: a plain 9-17 weekday test contains lunch, so three visits to the
  // same weekday lunch spot classified it as the user's workplace and
  // suppressed it forever — killing the restaurants they visit most.
  it("does not count weekday lunch as workplace evidence", () => {
    expect(isWorkHours(12, true)).toBe(false);
    expect(isWorkHours(13, true)).toBe(false);
    expect(isWorkHours(11, true)).toBe(false);
    expect(isWorkHours(14, true)).toBe(false);
  });

  it("still counts the rest of the weekday workday", () => {
    expect(isWorkHours(9, true)).toBe(true);
    expect(isWorkHours(10, true)).toBe(true);
    expect(isWorkHours(15, true)).toBe(true);
    expect(isWorkHours(16, true)).toBe(true);
  });

  it("ignores hours outside the workday", () => {
    expect(isWorkHours(8, true)).toBe(false);
    expect(isWorkHours(17, true)).toBe(false);
    expect(isWorkHours(19, true)).toBe(false);
  });

  it("never treats a weekend stop as workplace evidence", () => {
    expect(isWorkHours(10, false)).toBe(false);
    expect(isWorkHours(12, false)).toBe(false);
    expect(isWorkHours(16, false)).toBe(false);
  });
});
