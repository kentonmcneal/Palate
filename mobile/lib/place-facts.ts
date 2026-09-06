// ============================================================================
// place-facts.ts — the two numbers every diner reads first, formatted once.
// ----------------------------------------------------------------------------
// Google's rating and price level are on 98% and 81% of the catalogue
// respectively, and they are the first things anybody looks at when choosing
// where to eat. They were on the Home pick and the Discover card and nowhere
// else, and the formatting lived in three copies that had already drifted:
// one clamped a price level above four and one returned null for it, one
// wrote "1.2k reviews" and one wrote "(1.2k)".
//
// One module, so a place reads the same on every screen it appears on.
// ============================================================================

/** "★ 4.5". Null when Google has no rating, which is not the same as zero. */
export function ratingMark(rating: number | null | undefined): string | null {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return null;
  return `★ ${rating.toFixed(1)}`;
}

/**
 * "$" to "$$$$". Google only ever emits 0 to 4, and 0 means "free", which no
 * restaurant is; both 0 and null render nothing rather than an empty string
 * that would leave a stray separator behind.
 */
export function priceMarks(level: number | null | undefined): string | null {
  if (level == null || !Number.isFinite(level)) return null;
  const n = Math.round(level);
  if (n < 1) return null;
  return "$".repeat(Math.min(4, n));
}

/** "1.2k" — thousands to one decimal, so a review count never runs past four
 *  characters and push a subline onto a second line. */
export function compactCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** "1.2k reviews" / "38 reviews" / "1 review". Null at zero: "0 reviews" is
 *  a fact nobody needs and it reads as a warning. */
export function reviewCount(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return `${compactCount(n)} ${Math.round(n) === 1 ? "review" : "reviews"}`;
}

export type PlaceFactSource = {
  rating?: number | null;
  price_level?: number | null;
  user_rating_count?: number | null;
};

/**
 * The three facts in the order the eye wants them: how good, how expensive,
 * how many people said so. Callers join what they want and colour the star
 * and the price themselves, because a subline on a white card and one on a
 * dark card do not share a colour.
 */
export function placeFacts(p: PlaceFactSource): {
  rating: string | null;
  price: string | null;
  reviews: string | null;
} {
  return {
    rating: ratingMark(p.rating),
    price: priceMarks(p.price_level),
    reviews: reviewCount(p.user_rating_count),
  };
}
