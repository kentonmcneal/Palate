import { mergeCuisinePools } from "../cuisine-catalogue";
import { buildCuisineChips, cuisineLabel } from "../mood";

// ============================================================================
// The chip has to exist before it can be tapped.
// ----------------------------------------------------------------------------
// "If I toggle to steakhouses and never eat steak it should still pull in top
// steakhouses." Two separate failures stood between that sentence and the app:
// the chip was never offered, and tapping it filtered a list with no steakhouse
// in it down to nothing. This covers the first.
// ============================================================================

describe("mergeCuisinePools", () => {
  it("offers a cuisine that exists nearby but not in the fetched pool", () => {
    const pool = [{ cuisine_type: "american" }, { cuisine_type: "mexican" }];
    const catalogue = [
      { cuisine: "american", place_count: 15 },
      { cuisine: "steakhouse", place_count: 3 },
    ];
    const merged = mergeCuisinePools(pool, catalogue);
    expect(merged.map((r) => r.cuisine_type)).toContain("steakhouse");
  });

  it("does not duplicate a cuisine both sources know about", () => {
    const merged = mergeCuisinePools(
      [{ cuisine_type: "American" }],
      [{ cuisine: "american", place_count: 15 }],
    );
    expect(merged).toHaveLength(1);
  });

  it("adds a cuisine once, however many places back it", () => {
    // The pool is ordered by personal fit and the catalogue is not. Repeating a
    // catalogue cuisine place_count times would push it above the live pool in
    // nearbyCuisines' frequency sort, which ranks by an accident of sourcing.
    const merged = mergeCuisinePools(
      [{ cuisine_type: "american" }],
      [{ cuisine: "steakhouse", place_count: 40 }],
    );
    expect(merged.filter((r) => r.cuisine_type === "steakhouse")).toHaveLength(1);
  });

  it("survives a catalogue with nothing in it", () => {
    const pool = [{ cuisine_type: "thai" }];
    expect(mergeCuisinePools(pool, [])).toEqual(pool);
  });

  it("puts a never-eaten cuisine on the chip row end to end", () => {
    // The user's own history: burgers and tacos, no steak anywhere.
    const breakdown = [
      { cuisine: "american", count: 12, percent: 60 },
      { cuisine: "mexican", count: 8, percent: 40 },
    ] as any;
    const pool = [{ cuisine_type: "american" }, { cuisine_type: "mexican" }];
    const catalogue = [{ cuisine: "steakhouse", place_count: 3 }];

    const before = buildCuisineChips(breakdown, pool);
    expect(before.map((c) => c.label)).not.toContain("Steakhouse");

    const after = buildCuisineChips(breakdown, mergeCuisinePools(pool, catalogue));
    expect(after.map((c) => c.label)).toContain(cuisineLabel("steakhouse"));
  });
});
