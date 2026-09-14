import {
  buildDigest,
  digestWindowStart,
  entriesForDigest,
  DIGEST_WINDOW_GRACE_MIN,
} from "../passive-digest";
import type { InboxEntry } from "../passive-confirm";

/**
 * The meal that was never asked about.
 *
 * 2026-09-13, a Sunday: the founder ate and the stop ended at 20:57:16 local.
 * The entry was written at 21:00:19 — nineteen seconds AFTER the 21:00 digest
 * had already fired with nothing to say, because at 21:00:00 his inbox was
 * empty. The next evening's window opened at the previous digest moment,
 * 21:00:00 on the 13th, which is three minutes AFTER his meal, so it was
 * excluded again and would have expired unasked at 48 hours.
 *
 * Detected too late for one notification and too early for the next.
 */
function entry(detectedAt: Date, over: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: `e-${detectedAt.getTime()}`,
    place_id: "p1",
    name: "Sonic Drive-In",
    address: "7450 Winchester Rd",
    alternates: [],
    detectedAt: detectedAt.getTime(),
    dwellMin: 25,
    confidenceBand: "medium",
    ...over,
  } as InboxEntry;
}

// 2026-09-13 is a Sunday, so the digest hour is 21:00 both nights.
const MEAL = new Date(2026, 8, 13, 20, 57, 16);
const NEXT_EVENING = new Date(2026, 8, 14, 21, 30, 0);

describe("a meal that lands just before the digest hour", () => {
  it("is inside the next evening's window", () => {
    const kept = entriesForDigest([entry(MEAL)], NEXT_EVENING);
    expect(kept).toHaveLength(1);
  });

  it("produces a digest worth notifying about", () => {
    const d = buildDigest([entry(MEAL)], NEXT_EVENING);
    expect(d.high.length + d.medium.length + d.low.length).toBe(1);
  });

  // The mechanism, stated directly, so a later refactor cannot quietly drop it
  // by recomputing the boundary "more cleanly".
  it("opens the window before the previous digest moment, not exactly on it", () => {
    const start = digestWindowStart(NEXT_EVENING);
    const previousDigestMoment = new Date(2026, 8, 13, 21, 0, 0);
    expect(start.getTime()).toBeLessThan(previousDigestMoment.getTime());
    expect(previousDigestMoment.getTime() - start.getTime())
      .toBe(DIGEST_WINDOW_GRACE_MIN * 60 * 1000);
  });

  it("covers the observed three-minute detect-to-write lag with room to spare", () => {
    expect(DIGEST_WINDOW_GRACE_MIN).toBeGreaterThanOrEqual(10);
  });
});

describe("the grace does not swallow the cycle", () => {
  // It must remain a grace, not a second window. An entry from the night
  // before last is genuinely stale and stays out.
  it("still excludes a meal from two cycles ago", () => {
    const old = new Date(2026, 8, 12, 19, 0, 0);
    expect(entriesForDigest([entry(old)], NEXT_EVENING)).toHaveLength(0);
  });

  it("still excludes a meal just outside the grace", () => {
    const justOutside = new Date(2026, 8, 13, 21, 0, 0);
    justOutside.setMinutes(justOutside.getMinutes() - (DIGEST_WINDOW_GRACE_MIN + 1));
    expect(entriesForDigest([entry(justOutside)], NEXT_EVENING)).toHaveLength(0);
  });

  it("still excludes anything detected in the future", () => {
    const later = new Date(NEXT_EVENING.getTime() + 60_000);
    expect(entriesForDigest([entry(later)], NEXT_EVENING)).toHaveLength(0);
  });

  it("keeps an ordinary same-evening meal", () => {
    const tonight = new Date(2026, 8, 14, 19, 30, 0);
    expect(entriesForDigest([entry(tonight)], NEXT_EVENING)).toHaveLength(1);
  });
});
