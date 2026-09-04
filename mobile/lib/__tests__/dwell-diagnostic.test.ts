import { dwellMinutes } from "../passive-pipeline";
import type { RawVisit } from "../passive-capture";

function raw(over: Partial<RawVisit>): RawVisit {
  return {
    id: "r1", latitude: 0, longitude: 0, horizontalAccuracy: 30,
    simulated: false, source: "visit",
    ...over,
  } as RawVisit;
}

// Dwell drives the 5-minute floor, the confidence score, AND the miss
// diagnostics that threshold tuning is argued from. Measuring it from CAPTURE
// rather than ARRIVAL understates a real sit-down meal by however long the app
// happened to be asleep, which makes a captured visit look like a drive-by.
describe("dwell is measured arrival to departure", () => {
  const arrival = Date.parse("2026-09-02T19:00:00Z");
  const departure = Date.parse("2026-09-02T19:40:00Z");

  it("reports the full sit, not the observed window", () => {
    const v = raw({
      arrivalAt: arrival,
      departureAt: departure,
      // App woke 37 minutes in. Capture-to-departure would say 3 minutes.
      capturedAt: Date.parse("2026-09-02T19:37:00Z"),
    });
    expect(dwellMinutes(v)).toBe(40);
  });

  it("is null when either endpoint is missing rather than guessing", () => {
    expect(dwellMinutes(raw({ arrivalAt: arrival }))).toBeNull();
    expect(dwellMinutes(raw({ departureAt: departure }))).toBeNull();
    expect(dwellMinutes(raw({}))).toBeNull();
  });

  it("does not depend on capturedAt at all", () => {
    const early = raw({ arrivalAt: arrival, departureAt: departure, capturedAt: arrival });
    const late = raw({ arrivalAt: arrival, departureAt: departure, capturedAt: departure });
    expect(dwellMinutes(early)).toBe(dwellMinutes(late));
  });
});
