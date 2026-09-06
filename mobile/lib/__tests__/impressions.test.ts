import { visibleFraction } from "../../components/Impressions";

// The viewability rule in isolation. The component around it is glue that a
// renderer test would exercise; the arithmetic is what decides whether a
// card counts as seen.
describe("visibleFraction", () => {
  const vp = { y: 1000, h: 800 };

  it("is 1 when the card sits wholly inside the viewport", () => {
    expect(visibleFraction({ y: 1100, h: 200 }, vp)).toBe(1);
  });

  it("is 0 when the card is entirely above or below", () => {
    expect(visibleFraction({ y: 0, h: 200 }, vp)).toBe(0);
    expect(visibleFraction({ y: 1800, h: 200 }, vp)).toBe(0);
    expect(visibleFraction({ y: 5000, h: 200 }, vp)).toBe(0);
  });

  it("measures the overlap when the card straddles an edge", () => {
    // Top 50px of a 200px card hidden above the fold.
    expect(visibleFraction({ y: 950, h: 200 }, vp)).toBeCloseTo(0.75);
    // Only the top quarter peeks in at the bottom.
    expect(visibleFraction({ y: 1750, h: 200 }, vp)).toBeCloseTo(0.25);
  });

  it("is 0 before the viewport has a height", () => {
    // Nothing has laid out yet; a card must not count as seen on a 0px screen.
    expect(visibleFraction({ y: 0, h: 200 }, { y: 0, h: 0 })).toBe(0);
  });

  it("never divides by a zero-height card", () => {
    expect(visibleFraction({ y: 1100, h: 0 }, vp)).toBe(0);
  });
});
