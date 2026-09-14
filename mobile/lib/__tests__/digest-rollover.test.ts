import { buildDigest, digestWindowStart, entriesForDigest } from "../passive-digest";
import type { InboxEntry } from "../passive-confirm";
import { buildEatingPattern } from "../eating-pattern";

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

  it("fires at 9pm Sunday to Thursday, and midnight after Friday and Saturday", () => {
    expect(digestHourOn(new Date("2026-09-06T12:00:00"))).toBe(21); // Sun
    expect(digestHourOn(new Date("2026-09-07T12:00:00"))).toBe(21); // Mon
    expect(digestHourOn(new Date("2026-09-03T12:00:00"))).toBe(21); // Thu
    // 24, not 0. setHours(24) rolls to 00:00 the NEXT morning, which is what
    // "Friday at midnight" means to a person: the END of Friday. Writing 0
    // would fire the Friday digest a day early, covering Thursday.
    expect(digestHourOn(new Date("2026-09-04T12:00:00"))).toBe(24); // Fri
    expect(digestHourOn(new Date("2026-09-05T12:00:00"))).toBe(24); // Sat
  });

  it("holds a Saturday dinner until midnight rather than asking at 9", () => {
    const when = digestTimeFor(new Date("2026-09-05T21:30:00"));
    // Saturday's slot lands at 00:00 on SUNDAY the 6th.
    expect(when.getDate()).toBe(6);
    expect(when.getHours()).toBe(0);
  });

  it("takes tomorrow's hour when rolling forward into a different night", () => {
    // 00:30 Sunday is past Saturday's midnight slot, so this rolls to Sunday's
    // own 9pm. Carrying the weekend hour forward would schedule Sunday at
    // midnight, a whole day late.
    const when = digestTimeFor(new Date("2026-09-06T00:30:00"));
    expect(when.getDate()).toBe(6);
    expect(when.getHours()).toBe(21);
  });

  it("spans the real gap when the hour changes overnight", () => {
    // Sunday's 9pm digest reaches back to Saturday's slot, which is 00:00
    // Sunday — twenty-one hours. A fixed 24h subtraction would reach into
    // Saturday morning and re-ask about a night already covered.
    const start = digestWindowStart(new Date("2026-09-06T21:30:00"));
    expect(start.getDate()).toBe(6);
    expect(start.getHours()).toBe(0);
  });
});

describe("the hour is fixed, not personalised", () => {
  const { digestHourOn, digestTimeFor } = require("../passive-digest");

  // digestHourOn used to consult personalDigestHour, which shifted the fire
  // time to an hour after that person's usual last meal. That is why a Sunday
  // digest was scheduled for 11pm while the founder was still waiting at nine.
  // A notification you cannot anticipate is one you stop trusting.
  const lateEater = { total: 40, byHour: { 22: 20, 21: 10, 20: 10 }, weekend: {} };

  it("ignores a late eater's pattern on a weeknight", () => {
    expect(digestHourOn(new Date("2026-09-07T12:00:00"), lateEater as never)).toBe(21);
  });

  it("ignores it on a weekend night too", () => {
    expect(digestHourOn(new Date("2026-09-05T12:00:00"), lateEater as never)).toBe(24);
  });

  it("schedules at the same moment with or without a pattern", () => {
    const withPattern = digestTimeFor(new Date("2026-09-07T18:00:00"), lateEater as never);
    const without = digestTimeFor(new Date("2026-09-07T18:00:00"));
    expect(withPattern.getTime()).toBe(without.getTime());
  });
});

describe("a low-confidence night waits, but only once", () => {
  const { digestTimeFor, buildDigest } = require("../passive-digest");
  const lowEntry = (id: string, at: Date) => ({
    id, place_id: id, name: id, address: "", alternates: [],
    detectedAt: at.getTime(), dwellMin: 12, confidenceBand: "low",
  });

  it("defers tonight's low-only digest to tomorrow", () => {
    const now = new Date("2026-09-07T19:00:00");          // Monday evening
    const d = buildDigest([lowEntry("a", new Date("2026-09-07T13:00:00"))], now);
    const when = digestTimeFor(now, null, d);
    expect(when.getDate()).toBe(8);                        // Tuesday
  });

  it("but asks on the second night rather than letting it expire", () => {
    // Inbox entries die at 48 hours. A second deferral does not delay the
    // question, it cancels it — and silence on ambiguous days is the exact
    // complaint that made low-only digests sendable in the first place.
    const now = new Date("2026-09-08T19:00:00");           // Tuesday evening
    const d = buildDigest([lowEntry("a", new Date("2026-09-07T13:00:00"))], now);
    const when = digestTimeFor(now, null, d);
    expect(when.getDate()).toBe(8);                        // tonight, not Wednesday
  });

  it("never defers a digest that has something it can name", () => {
    const now = new Date("2026-09-07T19:00:00");
    const sure = { ...lowEntry("b", new Date("2026-09-07T13:00:00")), confidenceBand: "high" };
    const d = buildDigest([sure], now);
    expect(digestTimeFor(now, null, d).getDate()).toBe(7);
  });
});
