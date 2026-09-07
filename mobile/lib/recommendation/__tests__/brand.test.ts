import { brandKey, normalizeName, uniqueByBrand } from "../brand";
import { shortlist } from "../shortlist";
import { founderGraph } from "./ranking-harness.test";

// ============================================================================
// The real case: ranked by compatibility, the founder's top three nearby were
// Huey's Poplar, Huey's Southwind and Hueys Germantown. All six Huey's in the
// catalogue carry chain_name = NULL and is_chain_brand = false, correctly, so
// no chain field could have caught it.
// ============================================================================

describe("brandKey", () => {
  it("groups the locations that caused this", () => {
    const k = brandKey("Huey's Poplar");
    expect(brandKey("Huey's Southwind")).toBe(k);
    expect(brandKey("Hueys Germantown")).toBe(k);
    expect(brandKey("Huey's Olive Branch")).toBe(k);
  });

  it("uses chain_name when the classifier set one", () => {
    expect(brandKey("Starbucks Reserve", "Starbucks")).toBe(brandKey("Starbucks Union Ave", "Starbucks"));
  });

  it("does not group everything behind a generic leading word", () => {
    expect(brandKey("The Second Line")).not.toBe(brandKey("The Gray Canary"));
    expect(brandKey("El Mero Taco")).not.toBe(brandKey("El Toro Loco"));
    expect(brandKey("Cafe Eclectic")).not.toBe(brandKey("Cafe Society"));
  });

  it("keeps distinct restaurants distinct", () => {
    const names = ["Acre Restaurant", "Southern Social", "Gus's World Famous Fried Chicken", "Mortimer's", "Belmont Grill"];
    expect(new Set(names.map((n) => brandKey(n))).size).toBe(names.length);
  });

  it("returns null for a nameless row rather than a key that groups them", () => {
    expect(brandKey("")).toBeNull();
    expect(brandKey(null)).toBeNull();
    expect(brandKey("   ")).toBeNull();
  });

  it("normalizes punctuation and case, which is the whole trick", () => {
    expect(normalizeName("Huey's  Poplar!")).toBe("hueys poplar");
  });
});

describe("uniqueByBrand", () => {
  const n = (x: { name: string }) => x.name;

  it("keeps the first, highest-ranked location and drops the rest", () => {
    const items = [{ name: "Huey's Poplar" }, { name: "Huey's Southwind" }, { name: "Acre Restaurant" }];
    expect(uniqueByBrand(items, n).map(n)).toEqual(["Huey's Poplar", "Acre Restaurant"]);
  });

  it("never groups two nameless rows together", () => {
    const items = [{ name: "" }, { name: "" }];
    expect(uniqueByBrand(items, n)).toHaveLength(2);
  });
});

describe("the shortlist itself", () => {
  type R = { google_place_id: string; name: string; cuisine_type: string; chain_name: string | null };
  const mk = (id: string, name: string): R =>
    ({ google_place_id: id, name, cuisine_type: "american", chain_name: null });
  const run = (items: R[]) => shortlist(items, {
    graph: founderGraph(), now: new Date(2026, 8, 8, 19, 30), seed: "u:2026-09-08",
    toInput: (t) => t as never, explore: false, size: 3,
  }).picks.map((p) => p.name);

  it("no longer offers one restaurant as all three suggestions", () => {
    const picks = run([
      mk("h1", "Huey's Poplar"), mk("h2", "Huey's Southwind"), mk("h3", "Hueys Germantown"),
      mk("o1", "Forest Hill Grill"), mk("o2", "Belmont Grill"), mk("o3", "Mortimer's"),
    ]);
    expect(picks.filter((p) => p.toLowerCase().includes("huey"))).toHaveLength(1);
    expect(new Set(picks).size).toBe(3);
  });

  it("keeps the best-ranked location, not an arbitrary one", () => {
    const picks = run([
      mk("h1", "Huey's Poplar"), mk("h2", "Huey's Southwind"),
      mk("o1", "Forest Hill Grill"), mk("o2", "Belmont Grill"),
    ]);
    expect(picks[0]).toBe("Huey's Poplar");
  });

  it("repeats a brand rather than returning short when the pool cannot do better", () => {
    // Two locations and nothing else nearby. Saying Huey's twice beats saying
    // nothing, which is the same trade the rest rule already makes.
    const picks = run([mk("h1", "Huey's Poplar"), mk("h2", "Huey's Southwind"), mk("h3", "Hueys Germantown")]);
    expect(picks).toHaveLength(3);
  });
});
