import { ratingMark, priceMarks, compactCount, reviewCount, placeFacts } from "../place-facts";

describe("place facts", () => {
  it("renders a rating to one decimal and nothing when there is none", () => {
    expect(ratingMark(4.5)).toBe("★ 4.5");
    expect(ratingMark(4)).toBe("★ 4.0");
    expect(ratingMark(null)).toBeNull();
    expect(ratingMark(undefined)).toBeNull();
    // Google sends 0 for "no rating yet"; a zero-star place is a bug, not a fact.
    expect(ratingMark(0)).toBeNull();
  });

  it("renders price only for the levels Google actually emits", () => {
    expect(priceMarks(1)).toBe("$");
    expect(priceMarks(4)).toBe("$$$$");
    // The two old copies disagreed here: one clamped, one returned null.
    expect(priceMarks(9)).toBe("$$$$");
    expect(priceMarks(0)).toBeNull();
    expect(priceMarks(null)).toBeNull();
  });

  it("keeps a review count to four characters", () => {
    expect(compactCount(38)).toBe("38");
    expect(compactCount(1200)).toBe("1.2k");
    expect(compactCount(12_400)).toBe("12.4k");
    expect(reviewCount(1)).toBe("1 review");
    expect(reviewCount(38)).toBe("38 reviews");
    expect(reviewCount(1200)).toBe("1.2k reviews");
    // Zero reviews reads as a warning rather than a fact.
    expect(reviewCount(0)).toBeNull();
    expect(reviewCount(null)).toBeNull();
  });

  it("hands back all three at once", () => {
    expect(placeFacts({ rating: 4.4, price_level: 2, user_rating_count: 2824 }))
      .toEqual({ rating: "★ 4.4", price: "$$", reviews: "2.8k reviews" });
    expect(placeFacts({})).toEqual({ rating: null, price: null, reviews: null });
  });
});
