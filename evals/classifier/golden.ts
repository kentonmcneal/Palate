// ============================================================================
// A labelled set for the classifier, built from real catalogue rows.
// ----------------------------------------------------------------------------
// Every entry below is a restaurant that actually exists in public.restaurants,
// with the primaryType and types Google actually returned for it. Nothing is
// invented: an eval built on made-up inputs measures the eval.
//
// The LABELS are mine, assigned from the name and the Google types. They are
// the weakest part of this file and the part most worth correcting — if a
// label here is wrong, the eval will happily report a correct classifier as
// broken. Change them freely; that is what they are for.
//
// `expected: null` is a real answer, not a gap. "Yum's" cannot be classified
// from a name and a generic type, and a classifier that guesses at it is worse
// than one that abstains — a wrong cuisine silently corrupts somebody's taste
// graph, while a missing one only fails to help. Cases marked `null` are how
// this eval resists rewarding confident nonsense.
// ============================================================================

export type GoldenCase = {
  name: string;
  primaryType?: string;
  types: string[];
  /** Expected cuisine_type. null means "should abstain". */
  expected: string | null;
  /** Why this case is here. */
  note: string;
};

export const GOLDEN: GoldenCase[] = [
  // --- Google states the cuisine outright. The rules must never miss these.
  { name: "Tokyo House", primaryType: "japanese_restaurant", types: ["japanese_restaurant", "sushi_restaurant", "restaurant", "food"], expected: "japanese", note: "explicit type" },
  { name: "Pranakhon", primaryType: "thai_restaurant", types: ["thai_restaurant", "restaurant", "food"], expected: "thai", note: "explicit type" },
  { name: "Han Dynasty University City", primaryType: "chinese_restaurant", types: ["chinese_restaurant", "restaurant", "food"], expected: "chinese", note: "explicit type" },
  { name: "Alma Cocina", primaryType: "mexican_restaurant", types: ["mexican_restaurant", "latin_american_restaurant", "restaurant", "food"], expected: "mexican", note: "explicit type, latin secondary" },
  { name: "El Mezcal", primaryType: "mexican_restaurant", types: ["mexican_restaurant", "latin_american_restaurant", "restaurant"], expected: "mexican", note: "explicit type" },
  { name: "Masala Kitchen: Kati Rolls & Platters", primaryType: "indian_restaurant", types: ["indian_restaurant", "restaurant", "food"], expected: "indian", note: "explicit type" },
  { name: "Ronnie Grisanti's", primaryType: "italian_restaurant", types: ["european_restaurant", "italian_restaurant", "restaurant", "food"], expected: "italian", note: "italian is secondary in types[]" },
  { name: "Hoodoo Brown BBQ", primaryType: "barbecue_restaurant", types: ["barbecue_restaurant", "restaurant", "food"], expected: "bbq", note: "explicit type" },
  { name: "Six Feet Under Pub & Fish House - Grant Park", primaryType: "seafood_restaurant", types: ["seafood_restaurant", "american_restaurant", "restaurant"], expected: "seafood", note: "seafood outranks the american secondary" },
  { name: "Shawarma Shack VA", primaryType: "mediterranean_restaurant", types: ["mediterranean_restaurant", "restaurant", "food"], expected: "mediterranean", note: "explicit type" },
  { name: "Minetta Tavern", primaryType: "french_restaurant", types: ["french_restaurant", "hamburger_restaurant", "brunch_restaurant", "american_restaurant"], expected: "french", note: "four competing food types, primary wins" },
  { name: "Dynasty Buffet", primaryType: "chinese_restaurant", types: ["chinese_restaurant", "buffet_restaurant", "asian_restaurant", "restaurant"], expected: "chinese", note: "format words mixed into types" },
  { name: "Oishi Japanese Express of Olive Branch", primaryType: "japanese_restaurant", types: ["japanese_restaurant", "restaurant", "food"], expected: "japanese", note: "explicit type" },
  { name: "Red Koi Express Japanese Cuisine", primaryType: "japanese_restaurant", types: ["japanese_restaurant", "restaurant", "food"], expected: "japanese", note: "explicit type" },

  // --- American, arrived at by different routes.
  { name: "Dyer's Burgers", primaryType: "hamburger_restaurant", types: ["hamburger_restaurant", "american_restaurant", "restaurant", "food"], expected: "american", note: "burger maps to american" },
  { name: "Southern Hands Homestyle Cooking", primaryType: "american_restaurant", types: ["soul_food_restaurant", "american_restaurant", "restaurant", "food"], expected: "american", note: "soul food leads types[]" },
  { name: "Ching's Hot Wings", primaryType: "chicken_wings_restaurant", types: ["chicken_wings_restaurant", "chicken_restaurant", "meal_takeaway", "restaurant"], expected: "american", note: "wings map to american" },

  // --- The gap: a generic type, with the answer sitting in the name.
  { name: "Rock'n Dough Pizza & Brewery", primaryType: "restaurant", types: ["restaurant", "food", "point_of_interest"], expected: "italian", note: "NAME says Pizza; Google says nothing" },
  { name: "A taste of the Caribbean", primaryType: "restaurant", types: ["restaurant", "food", "point_of_interest"], expected: "caribbean", note: "NAME says Caribbean" },
  { name: "Kim Mama's Bento Box", primaryType: "restaurant", types: ["restaurant", "food", "point_of_interest"], expected: "japanese", note: "NAME says Bento" },
  { name: "Rayford's Hotwings - Raleigh", primaryType: "restaurant", types: ["restaurant", "food", "point_of_interest"], expected: "american", note: "NAME says Hotwings" },
  { name: "Asados hondureños", primaryType: "restaurant", types: ["restaurant", "food", "point_of_interest"], expected: "latin-american", note: "NAME is Honduran" },

  // --- Abstaining is the right answer. A guess here corrupts a taste graph.
  { name: "Yum's", primaryType: "restaurant", types: ["restaurant", "food", "point_of_interest"], expected: null, note: "unknowable — must not guess" },
  { name: "Assembly Rooftop Lounge", primaryType: "restaurant", types: ["restaurant", "food", "point_of_interest"], expected: null, note: "unknowable — must not guess" },
  { name: "Green Room", primaryType: "sports_bar", types: ["sports_bar", "bar", "point_of_interest"], expected: null, note: "a bar has a format, not a cuisine" },
  { name: "Art House Café", primaryType: "cafe", types: ["cafe", "food", "point_of_interest"], expected: null, note: "a café has a format, not a cuisine" },
  { name: "Bower Penn", primaryType: "coffee_shop", types: ["coffee_shop", "cafe", "food_store", "store"], expected: null, note: "coffee shop" },

  // --- Desserts and bakeries: a cuisine of sorts, and a known edge.
  { name: "Nothing Bundt Cakes", primaryType: "cake_shop", types: ["cake_shop", "dessert_shop", "wholesaler", "confectionery"], expected: "dessert", note: "dessert is a cuisine_type in the vocabulary" },
];
