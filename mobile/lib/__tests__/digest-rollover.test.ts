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
    const lateDinner = entry("late", new Date("2026-09-01T21:00:00"));
    const nextEvening = new Date("2026-09-02T20:30:00");

    expect(entriesForDigest([lateDinner], nextEvening)).toHaveLength(1);
    expect(buildDigest([lateDinner], nextEvening).total).toBe(1);
  });

  it("still shows it when the digest is opened later that night", () => {
    // Opening at 11pm must not drop items off the top as the clock moves.
    const lateDinner = entry("late", new Date("2026-09-01T21:00:00"));
    expect(entriesForDigest([lateDinner], new Date("2026-09-02T23:00:00"))).toHaveLength(1);
  });

  it("does not resurface something already two days stale", () => {
    const old = entry("old", new Date("2026-08-30T12:00:00"));
    expect(entriesForDigest([old], new Date("2026-09-02T20:30:00"))).toHaveLength(0);
  });

  it("excludes a detection dated in the future", () => {
    const future = entry("future", new Date("2026-09-03T12:00:00"));
    expect(entriesForDigest([future], new Date("2026-09-02T20:30:00"))).toHaveLength(0);
  });

  it("opens the window at the previous digest hour, whatever time it is asked", () => {
    // Before today's 8:30pm the live window is the one that opened at
    // yesterday's — otherwise a morning check would show nothing at all.
    expect(digestWindowStart(new Date("2026-09-02T10:00:00")).toISOString())
      .toBe(new Date("2026-08-31T20:30:00").toISOString());
    expect(digestWindowStart(new Date("2026-09-02T21:00:00")).toISOString())
      .toBe(new Date("2026-09-01T20:30:00").toISOString());
  });

  it("holds a lunch logged this morning until the evening digest", () => {
    const lunch = entry("lunch", new Date("2026-09-02T12:30:00"));
    expect(entriesForDigest([lunch], new Date("2026-09-02T20:30:00"))).toHaveLength(1);
  });
});

// The other half of the calendar-day bug. buildDigest now carries a late
// dinner into the next digest — but digestTimeFor returned null once 8:30 had
// passed, so no notification was ever scheduled for it, and rescheduleDigest
// only re-runs when a NEW entry lands. The visit sat in the inbox and nobody
// was ever asked.
describe("digestTimeFor", () => {
  const { digestTimeFor, DIGEST_HOUR, DIGEST_MINUTE } = require("../passive-digest");

  it("schedules tonight when the slot is still ahead", () => {
    const when = digestTimeFor(new Date("2026-09-02T14:00:00"));
    expect(when.getDate()).toBe(2);
    expect(when.getHours()).toBe(DIGEST_HOUR);
    expect(when.getMinutes()).toBe(DIGEST_MINUTE);
  });

  it("rolls a 9pm capture to tomorrow instead of dropping it", () => {
    const when = digestTimeFor(new Date("2026-09-02T21:00:00"));
    expect(when.getDate()).toBe(3);
    expect(when.getHours()).toBe(DIGEST_HOUR);
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
