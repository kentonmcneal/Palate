import { listTitle } from "../featured-lists";

describe("listTitle", () => {
  it("drops the ten", () => {
    expect(listTitle("Top 10 Burgers")).toBe("Top Burgers");
    expect(listTitle("Top 10 BBQ")).toBe("Top BBQ");
  });
  it("leaves titles that never promised ten", () => {
    expect(listTitle("Top Cafés")).toBe("Top Cafés");
    expect(listTitle("Best Brunch")).toBe("Best Brunch");
  });
});
