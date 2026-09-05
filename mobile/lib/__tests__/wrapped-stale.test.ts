jest.mock("../supabase", () => ({ supabase: {} }));

import { wrappedIsStale } from "../wrapped";

// The Sunday cron writes one row a week, and the tab only ever read the newest
// stored row. Every meal eaten after Sunday 14:00 UTC was invisible until the
// NEXT Sunday — so an account with thirty restaurants opened Wrapped, saw a
// card reading one visit, and reasonably concluded it was broken.
describe("wrappedIsStale", () => {
  const thisWeek = "2026-08-31";

  it("is stale when the stored week is an earlier one", () => {
    expect(wrappedIsStale("2026-08-24", thisWeek)).toBe(true);
  });

  it("is current when the stored week is this one", () => {
    expect(wrappedIsStale("2026-08-31", thisWeek)).toBe(false);
  });

  it("is stale when nothing has ever been generated", () => {
    expect(wrappedIsStale(null, thisWeek)).toBe(true);
    expect(wrappedIsStale(undefined, thisWeek)).toBe(true);
  });

  it("regenerates rather than trusting a future-dated row", () => {
    // The cron computes the week from ITS clock, which has produced rows dated
    // ahead of the viewer's week. Anything that is not exactly this week gets
    // recomputed, rather than assuming newer means correct.
    expect(wrappedIsStale("2026-09-07", thisWeek)).toBe(true);
  });

  it("is stale when the same week has gained visits since the row was written", () => {
    // The row said 1 visit; the analytics under it said 5. Same week.
    expect(wrappedIsStale("2026-08-31", thisWeek, 1, 5)).toBe(true);
  });

  it("is current when the same week's count still matches", () => {
    expect(wrappedIsStale("2026-08-31", thisWeek, 5, 5)).toBe(false);
  });

  it("does not regenerate when the live count is unknown", () => {
    expect(wrappedIsStale("2026-08-31", thisWeek, 1, null)).toBe(false);
  });
});
