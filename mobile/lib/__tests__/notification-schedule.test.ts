import { PINGS, violatesQuietHours } from "../notification-schedule";

// These are promises to the user, encoded as tests: a future edit that
// introduces a 3am buzz or two nudges on one day should fail here, not on
// someone's lock screen.
describe("weekly discovery nudges", () => {
  it("never schedules outside waking hours", () => {
    for (const p of PINGS) {
      expect(violatesQuietHours(p)).toBe(false);
    }
  });

  it("puts at most one nudge on any given weekday", () => {
    const days = PINGS.map((p) => p.weekday);
    expect(new Set(days).size).toBe(days.length);
  });

  it("does not collide with the Sunday Wrapped reminder", () => {
    // notifications.ts owns Sunday (weekday 1) for the Wrapped reminder.
    expect(PINGS.some((p) => p.weekday === 1)).toBe(false);
  });

  it("keeps the total to three a week, as the Settings copy claims", () => {
    expect(PINGS).toHaveLength(3);
  });

  it("carries a destination for every nudge", () => {
    for (const p of PINGS) {
      expect(p.pathname).toMatch(/^\/\(tabs\)/);
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.body.length).toBeGreaterThan(0);
    }
  });

  it("lands the date-night nudge on Friday afternoon, as asked", () => {
    const friday = PINGS.find((p) => p.key === "friday_date_night");
    expect(friday).toBeDefined();
    expect(friday!.weekday).toBe(6); // iOS: 1=Sun … 6=Fri
    expect(friday!.hour).toBe(16);
    expect(friday!.params?.list).toBe("date-night");
  });
});
