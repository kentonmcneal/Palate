import { buildDigest, digestWindowStart, entriesForDigest } from "../passive-digest";
import type { InboxEntry } from "../passive-confirm";

function entry(id: string, detectedAt: Date): InboxEntry {
  return {
    id, place_id: `pid-${id}`, name: id, address: "", alternates: [],
    dwellMin: 30, detectedAt: detectedAt.getTime(),
  } as InboxEntry;
}

// The digest fires at 8:30pm, so a late dinner is detected AFTER it fires and
// misses that evening by construction. Under the old same-calendar-day filter
// the next evening's digest asked for "today", the 9pm visit belonged to
// yesterday, and nothing ever showed it again — every meal after 8:30pm was
// silently destroyed. These pin the behaviour that replaced it.
describe("digest rollover", () => {
  it("carries a 9pm visit into the next evening's digest", () => {
    const lateDinner = entry("late", new Date("2026-09-01T21:30:00"));
    const nextEvening = new Date("2026-09-02T21:00:00");

    expect(entriesForDigest([lateDinner], nextEvening)).toHaveLength(1);
    expect(buildDigest([lateDinner], nextEvening).total).toBe(1);
  });

  it("still shows it when the digest is opened later that night", () => {
    // Opening at 11pm must not drop items off the top as the clock moves.
    const lateDinner = entry("late", new Date("2026-09-01T21:30:00"));
    expect(entriesForDigest([lateDinner], new Date("2026-09-02T23:00:00"))).toHaveLength(1);
  });

  it("does not resurface something already two days stale", () => {
    const old = entry("old", new Date("2026-08-30T12:00:00"));
    expect(entriesForDigest([old], new Date("2026-09-02T21:00:00"))).toHaveLength(0);
  });

  it("excludes a detection dated in the future", () => {
    const future = entry("future", new Date("2026-09-03T12:00:00"));
    expect(entriesForDigest([future], new Date("2026-09-02T21:00:00"))).toHaveLength(0);
  });

  it("opens the window at the previous digest hour, whatever time it is asked", () => {
    // Before today's 8:30pm the live window is the one that opened at
    // yesterday's — otherwise a morning check would show nothing at all.
    expect(digestWindowStart(new Date("2026-09-02T10:00:00")).toISOString())
      .toBe(new Date("2026-08-31T21:00:00").toISOString());
    expect(digestWindowStart(new Date("2026-09-02T22:00:00")).toISOString())
      .toBe(new Date("2026-09-01T21:00:00").toISOString());
  });

  it("holds a lunch logged this morning until the evening digest", () => {
    const lunch = entry("lunch", new Date("2026-09-02T12:30:00"));
    expect(entriesForDigest([lunch], new Date("2026-09-02T21:00:00"))).toHaveLength(1);
  });
});

// The other half of the calendar-day bug. buildDigest now carries a late
// dinner into the next digest — but digestTimeFor returned null once 8:30 had
// passed, so no notification was ever scheduled for it, and rescheduleDigest
// only re-runs when a NEW entry lands. The visit sat in the inbox and nobody
// was ever asked.
describe("digestTimeFor", () => {
  const { digestTimeFor, digestHourOn, DIGEST_MINUTE } = require("../passive-digest");

  it("schedules tonight when the slot is still ahead", () => {
    const when = digestTimeFor(new Date("2026-09-02T14:00:00"));
    expect(when.getDate()).toBe(2);
    expect(when.getHours()).toBe(21);
    expect(when.getMinutes()).toBe(DIGEST_MINUTE);
  });

  it("rolls a post-digest capture to tomorrow instead of dropping it", () => {
    const when = digestTimeFor(new Date("2026-09-02T21:30:00"));
    expect(when.getDate()).toBe(3);
    expect(when.getHours()).toBe(21);
  });

  it("rolls across a month boundary", () => {
    const when = digestTimeFor(new Date("2026-09-30T23:30:00"));
    expect(when.getMonth()).toBe(9); // October
    expect(when.getDate()).toBe(1);
  });

  it("always returns a future time, at every hour of the day", () => {
    for (let h = 0; h < 24; h++) {
      const now = new Date(2026, 8, 2, h, 31);
      expect(digestTimeFor(now).getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

// Later on the nights people eat later. 2026-09-04 is a Friday, so the 5th is
// Saturday and the 6th is Sunday.
describe("weekday schedule", () => {
  const { digestTimeFor, digestHourOn, digestWindowStart } = require("../passive-digest");

  it("fires at 9pm Sunday to Thursday, 11pm Friday and Saturday", () => {
    expect(digestHourOn(new Date("2026-09-06T12:00:00"))).toBe(21); // Sun
    expect(digestHourOn(new Date("2026-09-07T12:00:00"))).toBe(21); // Mon
    expect(digestHourOn(new Date("2026-09-03T12:00:00"))).toBe(21); // Thu
    expect(digestHourOn(new Date("2026-09-04T12:00:00"))).toBe(23); // Fri
    expect(digestHourOn(new Date("2026-09-05T12:00:00"))).toBe(23); // Sat
  });

  it("holds a Saturday dinner until 11pm rather than asking at 9", () => {
    const when = digestTimeFor(new Date("2026-09-05T21:30:00"));
    expect(when.getDate()).toBe(5);
    expect(when.getHours()).toBe(23);
  });

  it("takes tomorrow's hour when rolling forward into a different night", () => {
    // 11:30pm Saturday is past Saturday's 11pm, so this rolls to Sunday — a
    // 9pm night. Carrying today's hour forward would schedule Sunday at 11.
    const when = digestTimeFor(new Date("2026-09-05T23:30:00"));
    expect(when.getDate()).toBe(6);
    expect(when.getHours()).toBe(21);
  });

  it("spans the real gap when the hour changes overnight", () => {
    // Sunday's 9pm digest covers back to Saturday's 11pm — TWENTY-TWO hours,
    // not 24. Subtracting a fixed day would reach back to Saturday 9pm and
    // re-ask about two hours of Saturday night that Saturday already covered.
    const start = digestWindowStart(new Date("2026-09-06T21:30:00"));
    expect(start.getDate()).toBe(5);
    expect(start.getHours()).toBe(23);
  });

  it("spans more than a day when the hour moves the other way", () => {
    // Friday's 11pm digest reaches back to Thursday's 9pm — 26 hours. The
    // window stretches and shrinks with the schedule; a fixed offset is wrong
    // in both directions.
    const start = digestWindowStart(new Date("2026-09-04T23:30:00"));
    expect(start.getDate()).toBe(3);
    expect(start.getHours()).toBe(21);
  });

  it("never leaves a gap between one window and the next", () => {
    // Every digest window must begin exactly where the previous one ended, or
    // visits fall between two digests and are never shown by either.
    for (let d = 1; d <= 14; d++) {
      const fireDay = new Date(2026, 8, d, 12, 0);
      const { digestMomentOn } = require("../passive-digest");
      const fire = digestMomentOn(fireDay);
      const prevDay = new Date(fireDay);
      prevDay.setDate(prevDay.getDate() - 1);
      expect(digestWindowStart(fire).getTime()).toBe(digestMomentOn(prevDay).getTime());
    }
  });
});
