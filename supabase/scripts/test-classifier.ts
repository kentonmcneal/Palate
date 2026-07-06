// Classifier behavior tests — run BEFORE any backfill to prove the eligibility
// and cuisine rules do what we intend on representative places.
//
//   cd supabase/scripts && npx tsx test-classifier.ts
//
// Pure + offline: exercises deriveClassification only. No network, no DB, no LLM.

import { deriveClassification, type GooglePlace } from "../functions/_shared/classifier";

type Case = {
  desc: string;
  place: GooglePlace;
  expectEligibility?: number;
  expectReason?: string | null;
  expectCuisine?: string | null;
  expectSubregion?: string | null;
  expectOccasionIncludes?: string[];
  expectOccasionExcludes?: string[];
  expectTagsInclude?: string[];
  expectCrowdInclude?: string[];
  expectCultural?: string;
};

const P = (over: Partial<GooglePlace>): GooglePlace => ({
  id: Math.random().toString(36).slice(2),
  displayName: { text: "Unnamed" },
  types: ["restaurant"],
  ...over,
});

const reviews = (...texts: string[]) => texts.map((t) => ({ text: { text: t } }));

const cases: Case[] = [
  // ---- Chains: must be excluded across formats ----
  { desc: "McDonald's (fast food)", place: P({ displayName: { text: "McDonald's" }, types: ["fast_food_restaurant", "restaurant"] }), expectEligibility: 0, expectReason: "fast_food" },
  { desc: "Chipotle Mexican Grill", place: P({ displayName: { text: "Chipotle Mexican Grill" }, types: ["mexican_restaurant", "restaurant"] }), expectEligibility: 0, expectReason: "national_chain" },
  { desc: "Location-prefixed 'Downtown Chipotle'", place: P({ displayName: { text: "Downtown Chipotle" }, types: ["mexican_restaurant"] }), expectEligibility: 0, expectReason: "national_chain" },
  { desc: "The Cheesecake Factory (sit-down chain)", place: P({ displayName: { text: "The Cheesecake Factory" }, types: ["restaurant"], priceLevel: "PRICE_LEVEL_MODERATE" }), expectEligibility: 0, expectReason: "national_chain" },
  { desc: "Olive Garden", place: P({ displayName: { text: "Olive Garden Italian Restaurant" }, types: ["italian_restaurant", "restaurant"] }), expectEligibility: 0, expectReason: "national_chain" },
  { desc: "Panda Express in a mall", place: P({ displayName: { text: "Panda Express" }, types: ["chinese_restaurant"], formattedAddress: "Westfield Mall Food Court" }), expectEligibility: 0 },

  // ---- Captive venues ----
  { desc: "Generic mall food court stall", place: P({ displayName: { text: "Sarku Teriyaki" }, types: ["restaurant"], formattedAddress: "100 Mall Dr, Food Court, Anytown" }), expectEligibility: 0, expectReason: "food_court" },
  { desc: "Airport concession (airport rule wins over chain)", place: P({ displayName: { text: "Shake Shack" }, types: ["hamburger_restaurant"], formattedAddress: "JFK International Airport, Terminal 4, Queens NY" }), expectEligibility: 0, expectReason: "airport" },
  { desc: "Independent at an airport", place: P({ displayName: { text: "Deep Blue Sushi" }, types: ["sushi_restaurant"], formattedAddress: "LaGuardia Airport, Terminal B" }), expectEligibility: 0, expectReason: "airport" },
  { desc: "Stadium concession", place: P({ displayName: { text: "Local Smoke BBQ" }, types: ["barbecue_restaurant"], formattedAddress: "1 MetLife Stadium Dr, East Rutherford" }), expectEligibility: 0, expectReason: "captive_venue" },

  // ---- Lounge disambiguation (the false-positive fix) ----
  { desc: "Hookah lounge (exclude)", place: P({ displayName: { text: "Cloud 9 Hookah Lounge" }, types: ["bar"] }), expectEligibility: 0 },
  { desc: "Airport club lounge (exclude)", place: P({ displayName: { text: "Centurion Lounge" }, types: ["restaurant"], formattedAddress: "JFK Airport Terminal 4" }), expectEligibility: 0 },
  { desc: "Real restaurant named '...Lounge' (KEEP)", place: P({ displayName: { text: "The Aviary Lounge" }, types: ["restaurant"], priceLevel: "PRICE_LEVEL_EXPENSIVE" }), expectEligibility: 1.0, expectReason: null },

  // ---- Hotels ----
  { desc: "Pure hotel (exclude)", place: P({ displayName: { text: "Marriott Downtown" }, types: ["lodging"], primaryType: "lodging" }), expectEligibility: 0, expectReason: "hotel" },
  { desc: "Named hotel restaurant (KEEP)", place: P({ displayName: { text: "The NoMad Restaurant" }, types: ["restaurant", "lodging"], primaryType: "restaurant", priceLevel: "PRICE_LEVEL_EXPENSIVE" }), expectEligibility: 1.0, expectReason: null },

  // ---- Non-restaurants ----
  { desc: "Convenience store (exclude)", place: P({ displayName: { text: "Corner Deli & Grocery" }, types: ["convenience_store", "grocery_store"] }), expectEligibility: 0, expectReason: "not_a_restaurant" },

  // ---- Cuisine coverage + fallback ----
  { desc: "Filipino spot", place: P({ displayName: { text: "Jeepney" }, types: ["filipino_restaurant", "restaurant"] }), expectCuisine: "filipino", expectEligibility: 1.0 },
  { desc: "Indonesian spot", place: P({ displayName: { text: "Selamat Pagi" }, types: ["indonesian_restaurant", "restaurant"] }), expectCuisine: "indonesian" },
  { desc: "Name-only Sichuan (fallback)", place: P({ displayName: { text: "Sichuan Impression" }, types: ["restaurant"] }), expectCuisine: "chinese", expectSubregion: "chinese_szechuan" },
  { desc: "Pho spot (bounded)", place: P({ displayName: { text: "Pho Saigon" }, types: ["vietnamese_restaurant"] }), expectSubregion: "vietnamese_pho" },
  { desc: "'Photography Cafe' must NOT be pho", place: P({ displayName: { text: "Photography Cafe" }, types: ["cafe", "coffee_shop"] }), expectCuisine: "café" },

  // ---- Unique independents stay in ----
  { desc: "Independent Mediterranean (KEEP)", place: P({ displayName: { text: "Miss Ada" }, types: ["mediterranean_restaurant", "restaurant"], priceLevel: "PRICE_LEVEL_MODERATE" }), expectEligibility: 1.0, expectCuisine: "mediterranean" },

  // ---- Occasion differentiation (same cuisine, different experience) ----
  {
    desc: "Mediterranean PARTY spot (from reviews)",
    place: P({
      displayName: { text: "Layla" }, types: ["mediterranean_restaurant", "restaurant"],
      reviews: reviews("This place turns into a party at night, the music is loud and everyone is dancing.", "Great scene, packed and loud, bottle service and a DJ on weekends."),
    }),
    expectOccasionIncludes: ["party"],
  },
  // ---- Google atmosphere attributes → deterministic occasion (no LLM) ----
  {
    desc: "Attributes: liveMusic + cocktails → party",
    place: P({ displayName: { text: "Habibi Mezze" }, types: ["mediterranean_restaurant", "restaurant"], liveMusic: true, servesCocktails: true }),
    expectOccasionIncludes: ["party"],
  },
  {
    desc: "Attributes: kid-friendly → family_gathering",
    place: P({ displayName: { text: "Mama's Table" }, types: ["italian_restaurant", "restaurant"], goodForChildren: true, menuForChildren: true }),
    expectOccasionIncludes: ["family_gathering"],
  },
  {
    desc: "Attributes: reservable + upscale → celebration/business",
    place: P({ displayName: { text: "Le Jardin" }, types: ["french_restaurant", "restaurant"], reservable: true, priceLevel: "PRICE_LEVEL_VERY_EXPENSIVE" }),
    expectOccasionIncludes: ["celebration", "business_dinner"],
  },
  {
    desc: "Mediterranean CELEBRATION/BUSINESS spot (from reviews)",
    place: P({
      displayName: { text: "Ilili" }, types: ["mediterranean_restaurant", "restaurant"], priceLevel: "PRICE_LEVEL_EXPENSIVE",
      reviews: reviews("We hosted my daughter's graduation dinner here, white tablecloths and impeccable service.", "Perfect for a business dinner to impress clients, very elegant and quiet."),
    }),
    expectOccasionIncludes: ["celebration", "business_dinner"],
    expectOccasionExcludes: ["party"],
  },

  // ---- Discovery signals: critic mentions, hidden-gem, tourist-trap ----
  {
    desc: "Michelin mention in reviews → critic tag",
    place: P({
      displayName: { text: "Kochi" }, types: ["korean_restaurant", "restaurant"],
      reviews: reviews("This Michelin-starred tasting menu was one of the best meals of my life."),
    }),
    expectTagsInclude: ["michelin"],
  },
  {
    desc: "Hidden-gem language → tag",
    place: P({
      displayName: { text: "Mamá" }, types: ["mexican_restaurant", "restaurant"],
      reviews: reviews("A true hidden gem, this hole-in-the-wall is where the locals go and no one else knows about it."),
    }),
    expectTagsInclude: ["hidden-gem", "local-favorite"],
  },
  {
    desc: "Tourist-trap language → crowd + tag",
    place: P({
      displayName: { text: "Times Sq Pasta" }, types: ["italian_restaurant", "restaurant"],
      reviews: reviews("Total tourist trap, overpriced and overrated, full of tourists and not worth the money."),
    }),
    expectTagsInclude: ["tourist-heavy"],
    expectCrowdInclude: ["tourist_heavy"],
  },
  {
    desc: "Rating × count: hidden gem (4.6 / 300)",
    place: P({ displayName: { text: "Corner Bistro X" }, types: ["restaurant"], rating: 4.6, userRatingCount: 300 }),
    expectTagsInclude: ["hidden-gem"], expectCultural: "hidden",
  },
  {
    desc: "Rating × count: high-traffic destination (4.2 / 25000)",
    place: P({ displayName: { text: "Famous Deli" }, types: ["restaurant"], rating: 4.2, userRatingCount: 25000 }),
    expectTagsInclude: ["high-traffic"], expectCrowdInclude: ["tourist_heavy"], expectCultural: "trending",
  },
];

let pass = 0, fail = 0;
const fails: string[] = [];

for (const c of cases) {
  const d = deriveClassification(c.place);
  const problems: string[] = [];

  if (c.expectEligibility !== undefined && d.recommendation_eligibility !== c.expectEligibility)
    problems.push(`eligibility ${d.recommendation_eligibility} ≠ ${c.expectEligibility} (reason=${d.ineligibility_reason})`);
  if (c.expectReason !== undefined && d.ineligibility_reason !== c.expectReason)
    problems.push(`reason "${d.ineligibility_reason}" ≠ "${c.expectReason}"`);
  if (c.expectCuisine !== undefined && d.cuisine_type !== c.expectCuisine)
    problems.push(`cuisine "${d.cuisine_type}" ≠ "${c.expectCuisine}"`);
  if (c.expectSubregion !== undefined && d.cuisine_subregion !== c.expectSubregion)
    problems.push(`subregion "${d.cuisine_subregion}" ≠ "${c.expectSubregion}"`);
  for (const occ of c.expectOccasionIncludes ?? [])
    if (!d.occasion_tags.includes(occ)) problems.push(`occasion missing "${occ}" (got ${d.occasion_tags.join(",") || "none"})`);
  for (const occ of c.expectOccasionExcludes ?? [])
    if (d.occasion_tags.includes(occ)) problems.push(`occasion should NOT include "${occ}"`);
  for (const t of c.expectTagsInclude ?? [])
    if (!(d.tags ?? []).includes(t)) problems.push(`tags missing "${t}" (got ${(d.tags ?? []).join(",") || "none"})`);
  for (const cr of c.expectCrowdInclude ?? [])
    if (!(d.crowd_energy ?? []).includes(cr)) problems.push(`crowd missing "${cr}" (got ${(d.crowd_energy ?? []).join(",") || "none"})`);
  if (c.expectCultural !== undefined && d.cultural_context !== c.expectCultural)
    problems.push(`cultural "${d.cultural_context}" ≠ "${c.expectCultural}"`);

  if (problems.length === 0) { pass += 1; }
  else { fail += 1; fails.push(`✗ ${c.desc}\n    ${problems.join("\n    ")}`); }
}

console.log(`\nClassifier tests: ${pass} passed, ${fail} failed (of ${cases.length})`);
if (fails.length) {
  console.log("\nFailures:\n" + fails.join("\n"));
  process.exit(1);
}
console.log("All classifier behavior tests passed. ✓");
