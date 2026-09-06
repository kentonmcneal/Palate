import { capByKey } from "../reranking";

const r = (name: string, cuisine: string | null) => ({ name, cuisine });

describe("capByKey", () => {
  it("stops three burger places being three burger places", () => {
    const out = capByKey(
      [r("a", "american"), r("b", "american"), r("c", "american"), r("d", "italian")],
      (x) => x.cuisine, 2, 3,
    );
    expect(out.map((x) => x.name)).toEqual(["a", "b", "d"]);
  });

  it("keeps ranked order otherwise", () => {
    const out = capByKey(
      [r("a", "american"), r("b", "italian"), r("c", "thai")],
      (x) => x.cuisine, 2, 3,
    );
    expect(out.map((x) => x.name)).toEqual(["a", "b", "c"]);
  });

  it("never returns a shorter list than it could have — a thin pool wins", () => {
    // Four American places and nothing else. Capping to two would hand the
    // user a list of two when three exist, which is worse than repetition.
    const out = capByKey(
      [r("a", "american"), r("b", "american"), r("c", "american"), r("d", "american")],
      (x) => x.cuisine, 2, 3,
    );
    expect(out).toHaveLength(3);
    expect(out.map((x) => x.name)).toEqual(["a", "b", "c"]);
  });

  it("does not cap on an unknown cuisine, which is not a cuisine", () => {
    const out = capByKey(
      [r("a", null), r("b", null), r("c", null)],
      (x) => x.cuisine, 2, 3,
    );
    expect(out).toHaveLength(3);
  });

  it("is case-insensitive, because the catalogue is not consistent", () => {
    const out = capByKey(
      [r("a", "American"), r("b", "american"), r("c", "AMERICAN"), r("d", "thai")],
      (x) => x.cuisine, 2, 3,
    );
    expect(out.map((x) => x.name)).toEqual(["a", "b", "d"]);
  });
});
