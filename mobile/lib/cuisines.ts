// ----------------------------------------------------------------------------
// cuisines.ts — the vocabulary the whole app agrees on.
// ----------------------------------------------------------------------------
// Taken from what is actually in the catalogue, not invented: a count over
// restaurants.cuisine_type on 2026-09-12 returned exactly these values, plus
// the handful that palate-insights' keyword table can produce but which no row
// happens to carry yet (bakery, café, bar).
//
// This exists because the "fix the cuisine" corrector offered EIGHT choices --
// italian, chinese, japanese, korean, thai, mexican, indian, mediterranean --
// and the catalogue's single most common cuisine is `american`, with 1,201 of
// 3,859 rows. A user at a burger place literally could not tell us what it was.
// Reported by a tester, and she was right.
//
// Offering a value the rest of the system does not recognise is worse than
// offering too few: cuisineHue has no colour for it, the taste graph has no
// axis for it, and the correction becomes an orphan. So this list is the
// contract, and anything added here should be added to the classifier too.
// ----------------------------------------------------------------------------

export const CUISINES = [
  "african",
  "american",
  "bakery",
  "bar",
  "bbq",
  "café",
  "caribbean",
  "chinese",
  "dessert",
  "filipino",
  "french",
  "healthy",
  "indian",
  "italian",
  "japanese",
  "korean",
  "latin-american",
  "mediterranean",
  "mexican",
  "middle-eastern",
  "seafood",
  "spanish",
  "steakhouse",
  "thai",
  "vietnamese",
] as const;

export type Cuisine = (typeof CUISINES)[number];

/** "middle-eastern" -> "Middle Eastern", "bbq" -> "BBQ", "café" -> "Café". */
export function cuisineLabel(c: string): string {
  if (c === "bbq") return "BBQ";
  return c
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
