import { weeklyTrend, weekLabel, MIN_IMPRESSIONS_FOR_RATE, type RecFunnelWeek } from "../rec-funnel";

// ============================================================================
// This is the permanent record of whether the ranker is getting better, so the
// thing to guard is that it never reports a confident number it has not
// earned. A take rate computed on three impressions is noise wearing a
// percentage.
// ============================================================================

const row = (week: string, over: Partial<RecFunnelWeek> = {}): RecFunnelWeek => ({
  week_start: week, surface: "home_recs", slot: "exploit", rank: 0,
  impressions: 0, clicks: 0, saves: 0, maps: 0, try_another: 0,
  not_interested: 0, visits_7d: 0, distinct_places: 0, distinct_users: 0,
  ...over,
});

describe("weeklyTrend", () => {
  it("sums every (surface, slot, rank) group into one line per week", () => {
    const t = weeklyTrend([
      row("2026-08-31", { impressions: 100, clicks: 2, visits_7d: 1 }),
      row("2026-08-31", { impressions: 50, saves: 1, maps: 1, visits_7d: 2 }),
    ]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ impressions: 150, taken: 4, visits: 3 });
  });

  it("counts clicks, saves and directions together as taken", () => {
    const t = weeklyTrend([row("2026-08-31", { impressions: 100, clicks: 1, saves: 2, maps: 3 })]);
    expect(t[0].taken).toBe(6);
  });

  it("withholds the rate below the floor rather than printing noise", () => {
    const t = weeklyTrend([row("2026-08-31", { impressions: MIN_IMPRESSIONS_FOR_RATE - 1, clicks: 1 })]);
    expect(t[0].takeRate).toBeNull();
  });

  it("reports the rate once the denominator is real", () => {
    const t = weeklyTrend([row("2026-08-31", { impressions: 200, clicks: 3 })]);
    expect(t[0].takeRate).toBe(1.5);
  });

  it("distinguishes a silent week from a week with no data", () => {
    const [busy] = weeklyTrend([row("2026-08-31", { impressions: 500, clicks: 0 })]);
    const [quiet] = weeklyTrend([row("2026-08-24", { impressions: 0 })]);
    expect(busy.takeRate).toBe(0);
    expect(quiet.takeRate).toBeNull();
  });

  it("puts the newest week first", () => {
    const t = weeklyTrend([row("2026-08-24"), row("2026-09-07"), row("2026-08-31")]);
    expect(t.map((w) => w.week)).toEqual(["2026-09-07", "2026-08-31", "2026-08-24"]);
  });
});

describe("weekLabel", () => {
  it("returns the input unchanged rather than 'Invalid Date'", () => {
    expect(weekLabel("nonsense")).toBe("nonsense");
  });

  it("renders a real week as a short date", () => {
    expect(weekLabel("2026-09-07")).toMatch(/\d/);
  });
});
