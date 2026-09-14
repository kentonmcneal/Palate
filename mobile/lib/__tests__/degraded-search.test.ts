import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ----------------------------------------------------------------------------
// An empty result is not proof of absence.
// ----------------------------------------------------------------------------
// When the daily Google budget trips, places-proxy answers HTTP 200 with
// `{ places: [], degraded: true }`. searchRestaurants destructured `places`
// alone and threw the flag away — while nearbyRestaurantsDetailed, four
// functions above it, had carried the flag correctly the whole time because
// passive capture needed it.
//
// So the screens said "Nothing by that name in our list yet" and "No matches":
// the app denying a restaurant exists because somebody else spent the budget.
// Worse, Discover gated its FREE local suggestions on `searchResults === null`,
// so a degraded search replaced catalogue matches the person could still tap.
// ----------------------------------------------------------------------------
describe("a search that did not run says so", () => {
  const places = read("lib/places.ts");

  it("exposes the degraded flag from the search path", () => {
    expect(places).toMatch(/export async function searchRestaurantsDetailed/);
    const fn = places.slice(places.indexOf("export async function searchRestaurantsDetailed"));
    expect(fn.slice(0, fn.indexOf("\n}"))).toMatch(/degraded/);
  });

  for (const rel of ["app/(tabs)/discover.tsx", "app/(tabs)/add.tsx"]) {
    it(`${rel} reads the flag rather than only the places`, () => {
      const src = read(rel);
      // The bare helper returns places only. A screen that renders an empty
      // state must use the detailed one, or it cannot tell "nothing there"
      // from "we didn't look".
      expect(src).toMatch(/searchRestaurantsDetailed/);
      expect(src).not.toMatch(/await searchRestaurants\(/);
      expect(src).toMatch(/degraded/i);
    });
  }

  it("Discover keeps the free local list when the wider search is spent", () => {
    const src = read("app/(tabs)/discover.tsx");
    // setSearchResults([]) on a degraded search is what wiped the local
    // suggestions: the list renders only while searchResults is null.
    const handler = src.slice(src.indexOf("async function runSearch"));
    const body = handler.slice(0, handler.indexOf("\n  }"));
    expect(body).toMatch(/degraded[\s\S]{0,200}setSearchResults\(null\)/);
  });
});
