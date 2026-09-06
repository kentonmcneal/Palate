import { foldFeedback, feedbackAdjustment, decay, FEEDBACK, type FeedbackRow } from "../feedback";

// ============================================================================
// The fold in isolation: what a row becomes, and what it can never become.
// ============================================================================

const NOW = new Date(2026, 8, 6, 12, 0).getTime();
const day = 86_400_000;
const at = (daysAgo: number, hour = 12) => new Date(NOW - daysAgo * day + (hour - 12) * 3_600_000).toISOString();
const row = (event: string, id: string, created_at: string, extra: Record<string, unknown> = {}): FeedbackRow =>
  ({ event, props: { google_place_id: id, ...extra }, created_at });

describe("foldFeedback", () => {
  it("counts a show with nothing taken that day as one pass, however many times the app was opened", () => {
    const rows = [0, 1, 2, 3, 4].map((h) => row("rec_restaurant_viewed", "A", at(0, 9 + h)));
    const f = foldFeedback(rows, NOW).get("A")!;
    // One pass, aged a few hours: just under 1, never 5.
    expect(f.untaken).toBeGreaterThan(0.99);
    expect(f.untaken).toBeLessThanOrEqual(1);
  });

  it("does not count a show as a pass on a day the place was opened, saved or routed to", () => {
    for (const taken of ["rec_restaurant_clicked", "rec_restaurant_saved", "rec_maps_opened"]) {
      const f = foldFeedback([
        row("rec_restaurant_viewed", "A", at(0, 10)),
        row(taken, "A", at(0, 20)),
      ], NOW).get("A")!;
      expect(f.untaken).toBe(0);
    }
  });

  it("separates days: three ignored days are three passes", () => {
    const rows = [0, 1, 2].map((d) => row("rec_restaurant_viewed", "A", at(d)));
    const f = foldFeedback(rows, NOW).get("A")!;
    expect(f.untaken).toBeGreaterThan(2.7);
    expect(f.untaken).toBeLessThanOrEqual(3);
  });

  it("halves a pass every fourteen days", () => {
    const fresh = foldFeedback([row("rec_restaurant_viewed", "A", at(0))], NOW).get("A")!.untaken;
    const old = foldFeedback([row("rec_restaurant_viewed", "A", at(14))], NOW).get("A")!.untaken;
    expect(old / fresh).toBeCloseTo(0.5, 3);
    expect(decay(28 * day, 14)).toBeCloseTo(0.25, 5);
  });

  it("keeps the freshest save rather than summing saves", () => {
    const f = foldFeedback([
      row("rec_restaurant_saved", "A", at(30)),
      row("rec_restaurant_saved", "A", at(0)),
    ], NOW).get("A")!;
    expect(f.save).toBeCloseTo(1, 5);
  });

  it("a visit wipes the passes before it, and keeps the ones after", () => {
    const rows = [
      row("rec_restaurant_viewed", "A", at(5)),
      row("rec_restaurant_viewed", "A", at(4)),
      row("rec_try_another", "A", at(4)),
      row("rec_restaurant_viewed", "A", at(1)),
    ];
    const visitedAt = new Date(at(3)).getTime();
    const f = foldFeedback(rows, NOW, { lastVisitAt: new Map([["A", visitedAt]]) }).get("A")!;
    expect(f.skips).toBe(0);
    expect(f.untaken).toBeCloseTo(decay(1 * day, 14), 5);
  });

  it("ignores rows without a place id and unknown events", () => {
    const out = foldFeedback([
      { event: "rec_restaurant_viewed", props: {}, created_at: at(0) },
      row("rec_pool", "A", at(0)),
      row("visit_logged", "A", at(0)),
    ], NOW);
    expect(out.size).toBe(0);
  });

  it("remembers when a place was last on screen", () => {
    const f = foldFeedback([
      row("rec_restaurant_viewed", "A", at(9)),
      row("rec_restaurant_viewed", "A", at(2)),
    ], NOW).get("A")!;
    expect(f.lastSeenAt).toBe(new Date(at(2)).getTime());
  });
});

describe("feedbackAdjustment", () => {
  const ledger = (f: Partial<Parameters<typeof feedbackAdjustment>[0] extends Map<string, infer V> ? V : never>) =>
    new Map([["A", { untaken: 0, clicks: 0, maps: 0, skips: 0, save: 0, lastSeenAt: null, ...f }]]);

  it("is exactly zero, not negative zero, for a place never interacted with", () => {
    expect(Object.is(feedbackAdjustment(new Map(), "A"), 0)).toBe(true);
    expect(Object.is(feedbackAdjustment(ledger({}), "A"), 0)).toBe(true);
  });

  it("never leaves the clamp, whatever the counters say", () => {
    expect(feedbackAdjustment(ledger({ untaken: 1e6, skips: 1e6 }), "A")).toBe(FEEDBACK.min);
    expect(feedbackAdjustment(ledger({ clicks: 1e6, maps: 1e6, save: 1e6 }), "A")).toBe(FEEDBACK.max);
    expect(feedbackAdjustment(ledger({ untaken: -1e6 }), "A")).toBeLessThanOrEqual(FEEDBACK.max);
  });

  it("prices the gestures the way the design says", () => {
    expect(feedbackAdjustment(ledger({ untaken: 1 }), "A")).toBe(-2.5);
    expect(feedbackAdjustment(ledger({ untaken: 2 }), "A")).toBe(-5);
    expect(feedbackAdjustment(ledger({ untaken: 4 }), "A")).toBe(-10);
    expect(feedbackAdjustment(ledger({ untaken: 9 }), "A")).toBe(-10);
    expect(feedbackAdjustment(ledger({ clicks: 1 }), "A")).toBe(1.5);
    expect(feedbackAdjustment(ledger({ maps: 1 }), "A")).toBe(3);
    expect(feedbackAdjustment(ledger({ save: 1 }), "A")).toBe(3);
    expect(feedbackAdjustment(ledger({ skips: 1 }), "A")).toBe(-3);
    // Directions and two looks after two ignored days: the intent outweighs
    // the passes by exactly the amount the table says, no more.
    expect(feedbackAdjustment(ledger({ untaken: 2, maps: 1, clicks: 2 }), "A")).toBe(1);
  });
});
